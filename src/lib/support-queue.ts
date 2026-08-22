/**
 * support-queue.ts
 * The customer service agent queue.
 *
 * Exactly five named agents — Turkish names, mixed girls and boys — the way a
 * real call centre would roster them. A chat occupies one agent; when all five
 * are busy, new chats wait and are admitted as slots free up.
 *
 * Slots are kept alive by heartbeats from the client and expire after two
 * silent minutes, so a closed tab can never hold an agent hostage.
 *
 * ── Why this is in Redis and not a Map ────────────────────────────────────
 *
 * It used to live on `globalThis`. That is correct for exactly one server
 * process and wrong the moment there are two: each instance kept its own idea
 * of who was busy, so the same agent was handed to several people at once and
 * a chat that reconnected onto a different instance found its slot missing.
 * The app runs on Vercel, which is many instances by design.
 *
 * Claiming an agent is the part that has to be atomic — read-then-write loses
 * the race — so each agent is one key taken with SET NX. Redis decides the
 * winner in a single step. The TTL doubles as the crash handler: an instance
 * that dies mid-chat releases its agent when the key expires, with no cleanup
 * job needed.
 *
 * Without Upstash configured this falls back to the in-process map, which is
 * exactly the old behaviour — correct for local dev, no worse anywhere else.
 *
 * The chats themselves are persisted separately (the join route creates a
 * chat_sessions row and a support ticket), so nothing here is a record — it is
 * live operational state only.
 */

import { redisState } from './redis';

export const SUPPORT_AGENTS = [
  { name: 'Merve', gender: 'female' },
  { name: 'Emre', gender: 'male' },
  { name: 'Zeynep', gender: 'female' },
  { name: 'Kerem', gender: 'male' },
  { name: 'Elif', gender: 'female' },
] as const;

export type SupportAgentName = (typeof SUPPORT_AGENTS)[number]['name'];

/** Two silent minutes and the agent is considered abandoned. */
const SLOT_TTL_SECONDS = 120;
/** A waiting ticket lives ten minutes before it is forgotten. */
const WAIT_TTL_SECONDS = 10 * 60;

/**
 * How long a support chat is assumed to run, used only to estimate the wait
 * for people in the queue.
 *
 * This is an assumption, not a measurement. The slot TTL cannot stand in for
 * it: the heartbeat refreshes that every few seconds for as long as the tab is
 * open, so it says "still alive", never "nearly done".
 */
const TYPICAL_CHAT_MS = 6 * 60 * 1000;
/** Never promise sooner than this — an estimate of "5 seconds" reads as broken. */
const MIN_ETA_SECONDS = 30;

const agentKey = (name: string) => `support:agent:${name}`;
const ticketKey = (ticketId: string) => `support:ticket:${ticketId}`;
const QUEUE_COUNTER = 'support:queue:seq';
const ROTATION_COUNTER = 'support:rr';

export type QueueStatus =
  | { status: 'connected'; agent: SupportAgentName; position: null; etaSeconds: null }
  | { status: 'waiting'; agent: null; position: number; etaSeconds: number }
  | { status: 'dropped'; agent: null; position: null; etaSeconds: null };

// ── Slot values ─────────────────────────────────────────────────────────────
// A slot holds `<sessionId>|<claimedAtMs>` rather than a bare session id, so
// the queue can say how long a chat has been running. Everything that compares
// or renews a slot has to go through these two helpers — renewing with a
// freshly built value would reset the clock on every heartbeat and the
// estimate would never move.

const slotValue = (sessionId: string) => `${sessionId}|${Date.now()}`;

function parseSlot(raw: string | null): { sessionId: string; claimedAt: number } | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf('|');
  if (sep === -1) return { sessionId: raw, claimedAt: Date.now() };
  return { sessionId: raw.slice(0, sep), claimedAt: Number(raw.slice(sep + 1)) || Date.now() };
}

/** Read all five slots at once. Reads don't race each other; only claims do. */
async function readSlots(): Promise<(string | null)[]> {
  return Promise.all(SUPPORT_AGENTS.map((a) => redisState.get(agentKey(a.name))));
}

/**
 * The agent serving this session, with the raw slot value so callers can renew
 * or release the exact string they found.
 */
async function heldSlot(
  sessionId: string,
): Promise<{ agent: SupportAgentName; raw: string } | null> {
  const slots = await readSlots();
  for (let i = 0; i < SUPPORT_AGENTS.length; i++) {
    const parsed = parseSlot(slots[i]);
    if (parsed?.sessionId === sessionId) {
      return { agent: SUPPORT_AGENTS[i].name, raw: slots[i]! };
    }
  }
  return null;
}

/**
 * Take the first free agent, atomically. Null when all five are busy.
 *
 * The starting point rotates rather than always being index 0. Scanning from
 * the top meant Merve took nearly every chat and Elif almost none, which reads
 * as a single overworked person rather than a team. The claim itself is still
 * sequential and still atomic — only where the scan begins moves.
 */
async function claimFreeAgent(sessionId: string): Promise<SupportAgentName | null> {
  const seq = await redisState.increment(ROTATION_COUNTER, 3600);
  const offset = seq % SUPPORT_AGENTS.length;

  for (let i = 0; i < SUPPORT_AGENTS.length; i++) {
    const agent = SUPPORT_AGENTS[(offset + i) % SUPPORT_AGENTS.length];
    const got = await redisState.claim(agentKey(agent.name), slotValue(sessionId), SLOT_TTL_SECONDS);
    if (got) return agent.name;
  }
  return null;
}

/**
 * Roughly how long until a slot frees up, in seconds.
 *
 * Takes the chat that started earliest — the one closest to finishing under
 * the assumed duration — and reports what is left of it.
 */
async function estimateWaitSeconds(): Promise<number> {
  const slots = await readSlots();
  const now = Date.now();

  let soonest = Infinity;
  for (const raw of slots) {
    const parsed = parseSlot(raw);
    // An empty slot means somebody is about to be admitted anyway.
    if (!parsed) return MIN_ETA_SECONDS;
    soonest = Math.min(soonest, Math.max(0, TYPICAL_CHAT_MS - (now - parsed.claimedAt)));
  }

  if (!Number.isFinite(soonest)) return MIN_ETA_SECONDS;
  return Math.max(MIN_ETA_SECONDS, Math.round(soonest / 1000));
}

/**
 * Occupy a free slot immediately, or issue a ticket for the queue.
 *
 * Reconnecting is not a new arrival: a session that already holds an agent
 * gets the same one back rather than taking a second slot.
 */
export async function joinSupportQueue(sessionId: string): Promise<{
  ticketId: string;
  result: QueueStatus;
}> {
  const existing = await heldSlot(sessionId);
  if (
    existing &&
    (await redisState.renewIfHeld(agentKey(existing.agent), existing.raw, SLOT_TTL_SECONDS))
  ) {
    return {
      ticketId: '',
      result: { status: 'connected', agent: existing.agent, position: null, etaSeconds: null },
    };
  }

  const free = await claimFreeAgent(sessionId);
  if (free) {
    return {
      ticketId: '',
      result: { status: 'connected', agent: free, position: null, etaSeconds: null },
    };
  }

  // All busy. The position is a monotonic counter rather than an index into a
  // shared list — it only has to give the person a sense of movement, and a
  // counter needs no coordination between instances to do that.
  const ticketId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const seq = await redisState.increment(QUEUE_COUNTER, WAIT_TTL_SECONDS);
  await redisState.renew(ticketKey(ticketId), sessionId, WAIT_TTL_SECONDS);

  return {
    ticketId,
    result: {
      status: 'waiting',
      agent: null,
      position: Math.max(1, seq % 20),
      etaSeconds: await estimateWaitSeconds(),
    },
  };
}

/**
 * Poll: keep-alive for connected chats, and the admission check for waiting
 * ones. Called every few seconds by the client.
 */
export async function pollSupportQueue(
  ticketId: string,
  sessionId: string,
): Promise<QueueStatus> {
  const held = await heldSlot(sessionId);
  if (held) {
    // Heartbeat — without this the slot expires mid-conversation. Renewed with
    // the value we found, so the claim time (and the estimate) survives.
    if (await redisState.renewIfHeld(agentKey(held.agent), held.raw, SLOT_TTL_SECONDS)) {
      return { status: 'connected', agent: held.agent, position: null, etaSeconds: null };
    }
    // The slot expired in the gap between reading it and renewing it. Take it
    // straight back if it is still free — specifically *that* agent, because
    // it is the name the customer has been talking to. Handing back a
    // different one mid-conversation would be worse than dropping.
    if (await redisState.claim(agentKey(held.agent), held.raw, SLOT_TTL_SECONDS)) {
      return { status: 'connected', agent: held.agent, position: null, etaSeconds: null };
    }
  }

  // Not connected. Is this a live ticket?
  if (!ticketId) return { status: 'dropped', agent: null, position: null, etaSeconds: null };
  const ticket = await redisState.get(ticketKey(ticketId));
  if (!ticket) return { status: 'dropped', agent: null, position: null, etaSeconds: null };

  const free = await claimFreeAgent(sessionId);
  if (free) {
    await redisState.releaseIfHeld(ticketKey(ticketId), sessionId);
    return { status: 'connected', agent: free, position: null, etaSeconds: null };
  }

  // Still waiting — keep the ticket alive.
  await redisState.renew(ticketKey(ticketId), sessionId, WAIT_TTL_SECONDS);
  return {
    status: 'waiting',
    agent: null,
    position: 1,
    etaSeconds: await estimateWaitSeconds(),
  };
}

/** Free the slot or drop the ticket. */
export async function leaveSupportQueue(ticketId: string | null, sessionId: string) {
  if (ticketId) await redisState.releaseIfHeld(ticketKey(ticketId), sessionId);
  const held = await heldSlot(sessionId);
  if (held) await redisState.releaseIfHeld(agentKey(held.agent), held.raw);
}

/** Operational view — how many of the five agents are occupied right now. */
export async function queueSnapshot() {
  const slots = await readSlots();
  const occupied = SUPPORT_AGENTS.filter((_, i) => slots[i]).map((a) => a.name);
  return {
    totalAgents: SUPPORT_AGENTS.length,
    occupied,
    free: SUPPORT_AGENTS.length - occupied.length,
  };
}
