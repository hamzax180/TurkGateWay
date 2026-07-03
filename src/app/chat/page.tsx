'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, User, Mic, Plus, ChevronDown, Building2, FileText, Search, Clock, HelpCircle, Scale, Menu, GraduationCap, Cpu, X, Volume2, VolumeX, ArrowRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import LoadingScreen from '../components/LoadingScreen';
import OnboardingWizard from '../components/OnboardingWizard';

type Role = 'assistant' | 'user';
interface Msg { id: number; role: Role; content: string; }

// ── Pre-written demo answers for Student Help Quick Topics — no API needed ──
const CANNED_RESPONSES: Record<string, string> = {
  // Quick Topics
  "'How do I register for university?'": "🎓 **University Registration**\n\nCongratulations on your acceptance! 🎉 Registration happens in two phases:\n\n✅ **Action Steps:**\n1. **Online:** Pre-register via your university portal or YÖKSİS.\n2. **In-Person:** Submit your original physical documents to Student Affairs.\n\n💬 Which university are you enrolling in?",
  "How do I register for university?": "🎓 **University Registration**\n\nCongratulations on your acceptance! 🎉 Registration happens in two phases:\n\n✅ **Action Steps:**\n1. **Online:** Pre-register via your university portal or YÖKSİS.\n2. **In-Person:** Submit your original physical documents to Student Affairs.\n\n💬 Which university are you enrolling in?",
  "'I lost my student ID card.'": "🎓 **Lost Student ID?**\n\nDon't panic! Here is the exact process to get a replacement:\n\n✅ **Action Steps:**\n1. **Police Report:** Go to the nearest police station to get a loss declaration (Kayıp Tutanağı).\n2. **Student Affairs:** Take this report, a photo, and your enrollment certificate to your university.\n\n💬 Have you filed the police report yet?",
  "I lost my student ID card.": "🎓 **Lost Student ID?**\n\nDon't panic! Here is the exact process to get a replacement:\n\n✅ **Action Steps:**\n1. **Police Report:** Go to the nearest police station to get a loss declaration (Kayıp Tutanağı).\n2. **Student Affairs:** Take this report, a photo, and your enrollment certificate to your university.\n\n💬 Have you filed the police report yet?",
  "'How to get a student transport card?'": "🎓 **Student Transport Card**\n\nGetting a discounted transport card (like the Istanbulkart) is a massive money-saver! 🚌\n\n✅ **Action Steps:**\n1. Ensure your university has registered you on the YÖKSİS system.\n2. Apply online via the city's transport app or visit a main kiosk.\n\n💬 Which city are you studying in?",
  "How to get a student transport card?": "🎓 **Student Transport Card**\n\nGetting a discounted transport card (like the Istanbulkart) is a massive money-saver! 🚌\n\n✅ **Action Steps:**\n1. Ensure your university has registered you on the YÖKSİS system.\n2. Apply online via the city's transport app or visit a main kiosk.\n\n💬 Which city are you studying in?",
  "'Am I allowed to work as a student?'": "🎓 **International Student Work Permits**\n\nCan you work while studying? Yes, but with strict rules! 💼\n\n⚠️ **The Law:** Undergraduate students (Bachelors) can legally work part-time ONLY after completing their first year of study.\n\n💬 Are you currently in your first year?",
  "Am I allowed to work as a student?": "🎓 **International Student Work Permits**\n\nCan you work while studying? Yes, but with strict rules! 💼\n\n⚠️ **The Law:** Undergraduate students (Bachelors) can legally work part-time ONLY after completing their first year of study.\n\n💬 Are you currently in your first year?",

  // Suggestion Chips
  "Student Visas": "🎓 **Student Visa Guide**\n\nYou must apply for a Student Visa (Öğrenci Vizesi) at the Turkish Embassy/Consulate in your home country before traveling.\n\n📄 **Key Requirements:**\n• Official Acceptance Letter from your university\n• Valid Passport (at least 6 months validity)\n• 2 Biometric Photos\n• Proof of sufficient funds & health insurance\n\n⏳ **Duration:** Typically **3 months (90 days)**. Once you arrive in Turkey, you must apply for your Resident ID (**Ikamet**) before this expires!\n\n💬 Need help finding the nearest Turkish consulate?",
  "Renew Kimlik/ID": "🎓 **Student ID Renewal**\n\nTo renew your University ID (Kimlik), simply head to your faculty's **Student Affairs Office**.\n\n📄 **Bring with you:**\n• Your expired ID\n• 1 recent passport photo\n• Current enrollment certificate (Öğrenci Belgesi)\n\n💬 Have your documents ready? They usually print the new one in 3-5 days!",
  "Best Universities": "🎓 **Turkey's Top Universities**\n\nTurkey hosts fantastic, globally ranked institutions! 🌟\n\nHere are the top most competitive:\n1. Boğaziçi University (Istanbul)\n2. METU (Ankara)\n3. Koç University (Istanbul)\n4. ITU (Istanbul)\n\n💬 Are you looking for Engineering, Medical, or Business programs?",
  "Register Roadmap": "🎓 **University Registration**\n\nCongratulations on your acceptance! 🎉 Registration happens in two phases:\n\n✅ **Action Steps:**\n1. **Online:** Pre-register via your university portal or YÖKSİS.\n2. **In-Person:** Submit your original physical documents to Student Affairs.\n\n💬 Which university are you enrolling in?",
  "Deadlines": "🎓 **University Deadlines**\n\nI can certainly help you with registration calendars! 🎓 Which university are you targeting? \n\nPlease type the name (e.g., **Boğaziçi, METU, Istanbul University, Altınbaş**) and I will find the specific deadline and build your registration roadmap!",
  "Student Help": "🎓 **Student Support Center** 🆘\n\nI am designed to make your student life in Turkey seamless. \n\n🚀 **Quick Topics:**\n1. 'How do I register for university?'\n2. 'I lost my student ID card.'\n3. 'How to get a student transport card?'\n4. 'Am I allowed to work as a student?'\n\n💬 Is there a specific procedure you're stuck on right now?",
};

// ── Services that support New vs Renewal/Start flow ──
const RENEWAL_SERVICES = [
  // Student
  'ID / İkamet', 'Student Visa', 'Denklik (Equivalency)',
  'University Registration', 'Dormitory & Housing', 'IstanbulKart',
  // Permit
  'Cafe & Restaurant', 'Retail Shop', 'Office & Tech', 'Pharmacy', 'Clinic', 'Residence Permit',
  // Lawyer
  'Company Formation', 'Contract Review', 'Employment Law', 'Legal Disputes', 'Residency & Visas', 'Real Estate Law',
];

// ── Dynamic responses based on New vs Renewal selection ──
const SERVICE_FLOW_RESPONSES: Record<string, { ask: string; new: string; renewal: string }> = {
  // ── STUDENT ──────────────────────────────────────────────────
  'ID / İkamet': {
    ask: '🪪 **ID / İkamet (Residence Permit)**\n\nGreat choice! To give you the exact steps and documents, I need to know:\n\n**Is this a New application or a Renewal?**',
    new: '🪪 **New Student Residence Permit (İkamet)**\n\nWelcome to Turkey! 🇹🇷 Here is your complete roadmap for a **first-time** İkamet application:\n\n📋 **Required Documents:**\n• Valid Passport + photocopy of all pages\n• Student Visa entry stamp page\n• Öğrenci Belgesi (Active Student Certificate)\n• Health Insurance Policy (min. 1 year)\n• 4 Biometric Photos (white background)\n• Proof of Address (rental contract or dorm letter)\n• Tax Number (Vergi Numarası)\n• İkamet application fee receipt\n\n✅ **Steps:**\n1. Get your **Tax Number** from the nearest Tax Office.\n2. Buy **Health Insurance** — must meet SEDDK 2025 minimums (compliant policies typically cost 3,000–5,000+ TL/year; student-specific plans may start lower — compare at your insurer).\n3. Fill out the online application at **e-ikamet.goc.gov.tr**.\n4. Book your **appointment** at the Provincial Migration Office.\n5. Attend your appointment with **all original documents**.\n6. Your İkamet card will be mailed to your Turkish address.\n\n⏳ **Timeline:** Apply within **30 days** of arrival!\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🪪 **İkamet Renewal (Uzatma)**\n\nTime to renew! 🔄 Here is your complete checklist for a **renewal** application:\n\n📋 **Required Documents:**\n• Current/expired İkamet card (original)\n• Valid Passport + photocopy\n• Updated Öğrenci Belgesi (current semester)\n• Updated Health Insurance Policy (covering the new period)\n• 2 Biometric Photos\n• Updated Proof of Address (if changed)\n• Renewal application fee receipt\n\n✅ **Steps:**\n1. Start your renewal application at **e-ikamet.goc.gov.tr** (up to **60 days before** expiry).\n2. Upload your updated documents online.\n3. Book your renewal appointment at the Migration Office.\n4. Attend your appointment with all original documents.\n5. Your new İkamet card will be mailed to you.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Student Visa': {
    ask: '✈️ **Student Visa**\n\nI can guide you through the full process! First, I need to know:\n\n**Is this a New visa application or a Renewal/Extension?**',
    new: '✈️ **New Student Visa Application**\n\nYou must apply **before** traveling to Turkey! 🛂\n\n📋 **Required Documents:**\n• Valid Passport (at least 6 months validity)\n• Official University Acceptance Letter\n• 2 Biometric Photos\n• Completed Visa Application Form\n• Proof of Sufficient Funds (bank statement)\n• Health Insurance for Travel\n• Return/onward flight reservation\n• Accommodation proof in Turkey\n\n✅ **Steps:**\n1. Get your **university acceptance letter**.\n2. Locate the nearest **Turkish Embassy/Consulate**.\n3. Book a visa appointment online.\n4. Submit all documents + pay the visa fee.\n5. Wait **2-4 weeks** for processing.\n6. Collect your passport with the visa sticker.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '✈️ **Student Visa Extension/Renewal**\n\nIf you are already in Turkey, you typically transition to a **Residence Permit (İkamet)** rather than renewing the visa itself. 🔄\n\n📋 **Required Documents:**\n• Current Passport with existing visa\n• Proof of continued enrollment (Öğrenci Belgesi)\n• Valid Health Insurance\n• Financial proof for the extended period\n\n✅ **Steps:**\n1. Apply for your **Student İkamet** at e-ikamet.goc.gov.tr (this replaces the visa).\n2. If you must leave and re-enter, apply for a **new visa** at the Turkish consulate abroad.\n3. With a valid İkamet, you can **re-enter Turkey** without a new visa.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Denklik (Equivalency)': {
    ask: '📜 **Denklik (Diploma Equivalency)**\n\nTo give you the right guidance, I need to know:\n\n**Is this a New Denklik application or are you following up on a previous one?**',
    new: '📜 **New Denklik Application**\n\nDenklik is the official recognition of your high school diploma by the Turkish Ministry of Education. It is **mandatory** for undergraduate enrollment! 📜\n\n📋 **Required Documents:**\n• Original High School Diploma (Apostilled)\n• Official Transcript of Grades (Apostilled)\n• Notarized Turkish Translation of both documents\n• Valid Passport + photocopy\n• 2 Biometric Photos\n• University Acceptance Letter (if available)\n\n✅ **Steps:**\n1. **Apostille** your diploma & transcript in your home country.\n2. Get them **translated** and notarized by a sworn translator in Turkey.\n3. Visit the **e-Denklik** online portal and create an account.\n4. Upload all documents to the portal.\n5. Book an appointment at the **Ministry of Education (MEB)** office.\n6. Submit originals at your appointment.\n7. Wait **2-4 weeks** for the Denklik certificate.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '📜 **Denklik Follow-up / Correction**\n\nIf you have already applied and need to follow up or correct your Denklik: 🔄\n\n📋 **What You May Need:**\n• Previous Denklik application receipt/reference number\n• Any additional documents requested by MEB\n• Corrected or re-apostilled documents (if rejected)\n• Updated transcript (if additional courses were required)\n\n✅ **Steps:**\n1. Log in to the **e-Denklik portal** to check your application status.\n2. If documents are missing, upload the requested items.\n3. If your application was **conditionally approved**, complete the required exams.\n4. If **rejected**, review the reason and re-apply with corrected documents.\n5. Contact MEB directly at **+90 312 413 1475** for urgent inquiries.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'University Registration': {
    ask: '🏛️ **University Registration**\n\nAre you registering at a university for the **first time** in Turkey, or handling a **re-registration / transfer**?',
    new: '🏛️ **New University Registration**\n\nWelcome to your Turkish university! 🎓 Here are the steps to complete your enrollment:\n\n📋 **Required Documents:**\n• Official Acceptance Letter (Kabul Mektubu)\n• Denklik Certificate (High School Equivalency)\n• Valid Passport + notarized Turkish translation\n• 6 Biometric Photos\n• Student Visa or Entry Stamp\n• Health Certificate (from a Turkish hospital)\n• Proof of Payment of Tuition\n\n✅ **Steps:**\n1. Obtain your **Denklik** certificate if not yet done.\n2. Visit the **Student Affairs Office (Öğrenci İşleri)** with your documents.\n3. Complete the **online YÖKSİS / ÖYS registration** as directed by your university.\n4. Pay tuition and obtain **payment receipt**.\n5. Get your **student ID card** from the registrars.\n6. Register for the **Öğrenci Belgesi** (student certificate) through the portal.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🏛️ **University Re-registration / Semester Renewal**\n\nMaking sure your enrollment stays active! 🔄\n\n✅ **Steps:**\n1. Log in to your university\'s **Student Information System (ÖBS)**.\n2. Confirm your course selections for the new semester.\n3. Pay any outstanding **tuition or fees**.\n4. Download your updated **Öğrenci Belgesi** (student certificate).\n5. Renew your **student ID** at the registrars if expired.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Dormitory & Housing': {
    ask: '🛏️ **Dormitory & Housing**\n\nAre you looking for housing for the **first time**, or renewing/changing your current arrangement?',
    new: '🛏️ **Finding Student Housing in Turkey**\n\nHere\'s how to secure your accommodation as an international student: 🏠\n\n📋 **Options Available:**\n• KYK (Government) Dormitories — Cheapest, apply via **KYK portal**\n• University Dormitories — Apply via your university\'s housing office\n• Private Dormitories — Apply directly online\n• Rental Apartment — Through agents or platforms\n\n✅ **Steps:**\n1. Apply to **KYK dormitory** through **e-Devlet** (turkiye.gov.tr) — this is now the official application channel. Foreign students with a residence permit can apply, but Turkish students get priority.\n2. Apply to your **university\'s dorm** simultaneously.\n3. If both fail, search private dorms or apartments on **sahibinden.com** or **emlakjet.com**.\n4. For apartments, you will need a **guarantor (kefil)** or 3-6 months\' deposit.\n5. Register your address at the **local Muhtarlık** (neighborhood office) for official records.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🛏️ **Housing Renewal / Change**\n\nUpdating your living situation: 🔄\n\n✅ **Steps:**\n1. If renewing your current dorm: apply for the next term via the dorm portal before deadlines.\n2. If moving to a new place: notify your university\'s **Student Affairs Office** of your new address.\n3. Update your address at the **local Muhtarlık**.\n4. Update your address in your **İkamet (Residence Permit)** records at Göç İdaresi.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'IstanbulKart': {
    ask: '🚌 **IstanbulKart (Student Transport Card)**\n\nDo you need to **get a new** student IstanbulKart, or **renew/reload** an existing one?',
    new: '🚌 **Getting Your Student IstanbulKart**\n\nSave up to 50% on all Istanbul public transport with your student card! 🚇\n\n📋 **Required Documents:**\n• Active Student Certificate (Öğrenci Belgesi) from your university\n• Valid Passport or Turkish ID\n• **Valid Turkish Residence Permit (İkamet)** — required for foreign students to receive the discounted student card\n• 1 Passport-size photo\n\n✅ **Steps:**\n1. Get an updated **Öğrenci Belgesi** from your university\'s Student Affairs office.\n2. Go to the nearest **IstanbulKart Application Center** (Metrokent, Üsküdar, etc.) OR apply online.\n3. Fill out the application form and submit your documents.\n4. You will receive your **Student IstanbulKart** in 5-10 business days via post OR collect it in person.\n5. Load credit at any **top-up machine** or online via the İBB app.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🚌 **IstanbulKart Renewal**\n\nKeep your student discount active! 🔄\n\n✅ **Steps:**\n1. Get your new **Öğrenci Belgesi** showing your current enrollment.\n2. Visit an IstanbulKart center or go to **istanbulkart.istanbul** online.\n3. Submit the updated student document to refresh your **student discount status**.\n4. Your card will be re-validated for the new academic year.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },

  // ── PERMIT (Business) ──────────────────────────────────────────
  'Cafe & Restaurant': {
    ask: '☕ **Cafe & Restaurant**\n\nAre you opening a **new** cafe or restaurant, or making changes to an **existing** one?',
    new: '☕ **Opening a New Cafe or Restaurant in Istanbul**\n\nHere is your complete business permit roadmap! 🍽️\n\n📋 **Required Permits:**\n• Business License (İşyeri Açma ve Çalışma Ruhsatı)\n• Food Safety Certificate (Gıda Sicil)\n• Fire Safety Certificate (İtfaiye Raporu)\n• Alcohol License (if serving alcohol)\n• Sign License (Tabela Ruhsatı)\n\n✅ **Steps:**\n1. Register on **MERSİS** and establish your company (LLC or sole trader).\n2. Rent premises and get a **notarized lease agreement**.\n3. Apply for your **İşyeri Ruhsatı** at the local Belediye.\n4. Obtain **Fire Safety** inspection and certificate.\n5. Register with **Gıda Sicil** (Ministry of Food & Agriculture portal).\n6. If serving alcohol, apply for **Alkol Satış Ruhsatı** through the **Ministry of Agriculture and Forestry** portal at `tadbsatisbelgesi.tarimorman.gov.tr` (TAPDK was dissolved in 2017).\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '☕ **Renewing Cafe / Restaurant Licenses**\n\n🔄 Annual renewal checklist:\n\n✅ **Steps:**\n1. Renew **İşyeri Ruhsatı** at the local Belediye (usually annual).\n2. Renew **Gıda Sicil** certificate.\n3. Book a new **Fire Safety inspection** if required.\n4. Renew any **Alcohol License** via the Ministry of Agriculture and Forestry portal (`tadbsatisbelgesi.tarimorman.gov.tr`).\n5. Check sign license status and renew if needed.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Retail Shop': {
    ask: '🛍️ **Retail Shop**\n\nAre you opening a **new** retail store, or renewing licenses for an **existing** one?',
    new: '🛍️ **Opening a Retail Shop in Istanbul**\n\nHere is your complete permit roadmap! 🏪\n\n📋 **Required Permits:**\n• Company Registration (MERSİS)\n• İşyeri Açma Ruhsatı (Business Operating License)\n• Fire Safety Certificate\n• Sign License (Tabela Ruhsatı)\n• Tax Registration (Vergi Dairesi)\n\n✅ **Steps:**\n1. Register your company on **MERSİS** portal.\n2. Open a **tax account** at the local Vergi Dairesi.\n3. Apply for **İşyeri Ruhsatı** at the local Belediye with lease + company docs.\n4. Get a **Fire Safety** inspection and certificate from İtfaiye.\n5. Apply for a **Sign License** if you will have outdoor signage.\n6. Register with **e-Arşiv** for invoices over 3,000 TL. Full **e-Fatura** enrollment is mandatory once annual turnover exceeds 3 million TL — all invoicing will be fully electronic from 2026.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🛍️ **Retail Shop License Renewal**\n\n🔄 Annual renewal process:\n\n✅ **Steps:**\n1. Renew **İşyeri Ruhsatı** at the local Belediye.\n2. Renew **Fire Safety Certificate** if expired.\n3. Update business registration details on **MERSİS** if anything changed.\n4. Renew the **Sign License** if applicable.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Office & Tech': {
    ask: '💻 **Office & Tech Business**\n\nAre you setting up a **new** office or tech company, or updating an **existing** setup?',
    new: '💻 **Opening an Office / Tech Company in Istanbul**\n\nIdeal for software companies, freelancers, and startups! 🚀\n\n📋 **Required Steps:**\n• Company Formation via MERSİS (LLC — Limited Şirketi)\n• Notary-signed Articles of Association\n• Tax Registration (Vergi Numarası)\n• Social Security (SGK) employer registration\n• İşyeri Ruhsatı (if client-facing premises)\n\n✅ **Steps:**\n1. Reserve your company name and register on **MERSİS**.\n2. Prepare **Articles of Association** and sign before a notary.\n3. Open a **company bank account** and deposit minimum capital (50,000 TL for LLC as of 2024).\n4. Register with **Vergi Dairesi** for tax and invoicing.\n5. Register with **SGK** as an employer.\n6. If you have physical premises, apply for **İşyeri Ruhsatı** at the Belediye.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '💻 **Annual Office Compliance Renewal**\n\n🔄 Keep your office compliant:\n\n✅ **Steps:**\n1. File **annual corporate tax returns** with the Vergi Dairesi.\n2. Renew **İşyeri Ruhsatı** if you have physical premises.\n3. Update **SGK** records for any new employees.\n4. Update company details on **MERSİS** if address or partners changed.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Pharmacy': {
    ask: '🏥 **Pharmacy**\n\nAre you opening a **new** pharmacy, or renewing licenses for an **existing** one?',
    new: '🏥 **Opening a Pharmacy in Istanbul**\n\n⚠️ **Important Legal Notice:** Under Turkish **Law No. 6197**, pharmacy ownership is **restricted to Turkish citizens** who hold a Turkish pharmacy degree. Foreign nationals cannot own or operate a pharmacy in Turkey, regardless of their qualifications abroad.\n\nIf you are a Turkish citizen or have obtained Turkish citizenship, here is the process:\n\n📋 **Required Permits:**\n• Eczacı Ruhsatnamesi (Turkish Pharmacist License)\n• İşyeri Ruhsatı (Local Business License)\n• Sağlık Bakanlığı Approval (Ministry of Health)\n• TEB (Turkish Pharmacists Association) Membership\n• Fire Safety Certificate\n\n✅ **Steps (Turkish citizens only):**\n1. Verify your **Eczacı Ruhsatnamesi** is valid with the Ministry of Health.\n2. Register with **TEB (Türk Eczacıları Birliği)** and your local chamber.\n3. Find compliant premises (min. 40m²; distance rules apply — pharmacies cannot be too close to each other).\n4. Apply for **Ministry of Health pharmacy opening permit**.\n5. Obtain **İşyeri Ruhsatı** from the local Belediye.\n6. Install required **ECZANE BİS** pharmacy management software.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🏥 **Pharmacy License Renewal**\n\n🔄 Annual compliance:\n\n✅ **Steps:**\n1. Renew **TEB membership** and pay annual dues.\n2. Renew **İşyeri Ruhsatı** at the local Belediye.\n3. Update **Ministry of Health** records if any changes occurred.\n4. Ensure **ECZANE BİS** software is up to date.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Clinic': {
    ask: '🩺 **Medical Clinic**\n\nAre you opening a **new** private clinic, or renewing licenses for an **existing** one?',
    new: '🩺 **Opening a Private Clinic in Istanbul**\n\nPrivate healthcare in Turkey requires multiple approvals! 🏥\n\n📋 **Required Permits:**\n• Özel Sağlık Kuruluşu Ruhsatı (Ministry of Health License)\n• Tıp Fakültesi / Specialty Board Certification\n• İşyeri Ruhsatı (Local Business License)\n• Fire Safety Certificate\n• Waste Disposal Certification\n\n✅ **Steps:**\n1. Confirm your **medical specialty certification** is valid in Turkey.\n2. Apply to the **Ministry of Health (Sağlık Bakanlığı)** for private clinic authorization.\n3. Prepare premises meeting Ministry specifications (size, equipment, layout).\n4. Obtain **Fire Safety Certificate** from İtfaiye.\n5. Get **medical waste disposal** agreement with a licensed firm.\n6. Apply for **İşyeri Ruhsatı** at the local Belediye.\n7. Register with the **Ministry of Health Private Healthcare Services** system and your medical specialty chamber.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🩺 **Clinic License Renewal**\n\n🔄 Annual compliance:\n\n✅ **Steps:**\n1. Renew **Ministry of Health authorization** certificate.\n2. Renew **İşyeri Ruhsatı** at the local Belediye.\n3. Update **medical waste disposal** contract.\n4. Renew **Fire Safety Certificate** if expired.\n5. Submit annual report to your **specialty chamber**.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Residence Permit': {
    ask: '🏠 **Residence Permit (İkamet)**\n\nIs this for a **new** residence permit application, or renewing an **existing** one?',
    new: '🏠 **New Residence Permit (İkamet) — Work/Business**\n\nYou can stay legally in Turkey with a valid İkamet! 🇹🇷\n\n📋 **Required Documents:**\n• Valid Passport + photocopy\n• 4 Biometric Photos\n• Health Insurance Policy (1 year)\n• Proof of Address (lease/ownership)\n• Tax Number\n• Application Fee Receipt\n• Supporting document for purpose (work contract, business registration, etc.)\n\n✅ **Steps:**\n1. Get your **Tax Number** from the Vergi Dairesi.\n2. Purchase **Health Insurance** from a Turkish provider.\n3. Register on **e-ikamet.goc.gov.tr** and fill the application.\n4. Book your **Migration Office appointment**.\n5. Attend the appointment with all original documents.\n6. Receive your **İkamet card** by mail.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🏠 **Residence Permit Renewal**\n\n🔄 Time to renew your İkamet:\n\n✅ **Steps:**\n1. Apply up to **60 days before** your current permit expires on **e-ikamet.goc.gov.tr**.\n2. Renew your **Health Insurance** for the new period.\n3. Get updated **Proof of Address** if you have moved.\n4. Attend your **Migration Office appointment** with all originals.\n5. Receive your renewed **İkamet card** by mail.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },

  // ── LAWYER (Legal) ──────────────────────────────────────────────
  'Company Formation': {
    ask: '🏗️ **Company Formation**\n\nAre you forming a **brand new** company, or restructuring an **existing** entity?',
    new: '🏗️ **Forming a New Company in Turkey**\n\nTurkey is very investor-friendly! Here\'s how to set up your LLC (LTD Şti): 🏢\n\n📋 **Required Steps:**\n• MERSİS registration\n• Notarized Articles of Association\n• Founding partner passports + notarized translations\n• Minimum capital deposit (50,000 TL for LLC as of 2024)\n• SGK employer registration\n• Vergi Dairesi (Tax Office) registration\n\n✅ **Steps:**\n1. Choose your company type (LLC, Joint Stock, Branch Office, or Liaison Office).\n2. Register on **MERSİS** and select your company name.\n3. Prepare and sign **Articles of Association** before a notary.\n4. Deposit **minimum capital** into a company bank account.\n5. Register with the **Trade Registry**.\n6. Register with **Vergi Dairesi** for taxes.\n7. Register with **SGK** for employee social security.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🏗️ **Company Restructuring / Annual Compliance**\n\n🔄 Keeping your entity compliant:\n\n✅ **Steps:**\n1. File **annual financial statements** with the Trade Registry.\n2. Hold **Annual General Meeting (AGM)** and file minutes.\n3. Update **MERSİS** if directors or address changed.\n4. Renew any **branch licenses** or **operational permits**.\n5. Ensure **tax filings** are up to date with the Vergi Dairesi.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Contract Review': {
    ask: '📑 **Contract Review**\n\nAre you reviewing a **new** contract, or revisiting/amending an **existing** agreement?',
    new: '📑 **New Contract Review**\n\nProtect your rights under Turkish law! ⚖️\n\n📋 **What to Check:**\n• Governing law (Turkish law preferred for enforceability)\n• Dispute resolution clause (arbitration vs. court)\n• Payment terms and currency\n• Termination and penalty clauses\n• Intellectual property ownership\n• Confidentiality and non-compete terms\n\n✅ **Steps:**\n1. Provide the contract text to your **Turkish legal advisor**.\n2. Verify all parties are **legally identified** with correct tax/company numbers.\n3. Ensure the contract is in **Turkish** or has a certified Turkish translation.\n4. Review **penalty clauses** for compliance with Turkish Commercial Code.\n5. Have the contract **notarized** if it involves real estate or high-value transactions.\n6. Sign and retain **certified copies** of the executed contract.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '📑 **Contract Amendment / Renewal**\n\n🔄 Updating an existing agreement:\n\n✅ **Steps:**\n1. Draft a **Contract Amendment Addendum** specifying the changes.\n2. Ensure both parties **sign the amendment** with the same formality as the original.\n3. If the original was notarized, **notarize the amendment** too.\n4. Update the contract duration and any changed terms.\n5. Retain updated copies with all signatories.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Employment Law': {
    ask: '🤝 **Employment Law**\n\nAre you **hiring new** employees and need employment contracts, or resolving **ongoing** employment issues?',
    new: '🤝 **Hiring Employees in Turkey**\n\nTurkish labor law provides strong employee protections. Here\'s how to hire legally: 👷\n\n📋 **Key Requirements:**\n• Written employment contract (mandatory)\n• SGK registration of employee **at least 1 day before** start\n• Minimum wage compliance (2025: gross 26,005 TL / net 22,104 TL per month)\n• Annual leave entitlement (14 days minimum)\n• Termination notice periods\n\n✅ **Steps:**\n1. Draft a **Turkish employment contract** compliant with İş Kanunu (Labor Law No. 4857).\n2. Register the employee with **SGK (Social Security) at least one day before** their start date — same-day registration incurs fines under Law No. 5510 Article 8.\n3. Set up **payroll** including income tax withholding and SGK contributions.\n4. Register with **e-Bildirge** for monthly SGK declarations.\n5. Provide a **signed copy** of the employment contract to the employee.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🤝 **Employment Issue Resolution**\n\n🔄 Handling existing employment matters:\n\n✅ **Steps:**\n1. Review current contracts for **compliance with latest minimum wage** and leave laws.\n2. If terminating, follow **notice periods** and calculate **severance pay** correctly.\n3. File any disputes with **İş Mahkemesi** (Labor Court) within the statute of limitations.\n4. For renewals, issue a **contract extension addendum**.\n5. Update **SGK records** for any changes in role or salary.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Legal Disputes': {
    ask: '⚖️ **Legal Disputes**\n\nAre you **initiating** a new legal case, or managing an **ongoing** dispute?',
    new: '⚖️ **Initiating a Legal Case in Turkey**\n\nNavigating the Turkish court system: 🏛️\n\n📋 **Key Steps:**\n• Identify the correct court (Civil, Commercial, or Labor Court)\n• Prepare evidence and documentation\n• Calculate court fees (proportional to claim value)\n• Engage a licensed Turkish attorney (Avukat)\n\n✅ **Steps:**\n1. Consult a **licensed Turkish attorney (Avukat)** immediately.\n2. Collect all **evidence**: contracts, invoices, communications, receipts.\n3. File a **petition (dava dilekçesi)** with the appropriate court.\n4. Pay the **court fees** (harç) at the courthouse treasury.\n5. Serve the opposing party and await the **first hearing date**.\n6. Attend all hearings or authorize your attorney to represent you.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '⚖️ **Ongoing Dispute / Appeal**\n\n🔄 Managing an active legal case:\n\n✅ **Steps:**\n1. Review latest court decisions with your **Turkish attorney**.\n2. If unfavorable, calculate **appeal deadlines** (usually 2 weeks from decision).\n3. File an **appeal (istinaf or temyiz)** at the appropriate appellate court.\n4. Submit any outstanding evidence or expert witness requests.\n5. Attend scheduled **hearings** with your legal representative.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Residency & Visas': {
    ask: '🏠 **Residency & Visas (Legal Advice)**\n\nAre you navigating a **new** residency/visa matter, or handling an **ongoing** issue such as appeal or extension?',
    new: '🏠 **New Residency or Visa Matter — Legal Guidance**\n\nSolid legal advice on residency in Turkey: 🇹🇷\n\n📋 **Common Matters:**\n• Tourist to Resident transition\n• Work Permit (Çalışma İzni) application\n• Long-Term Residence Permit (8 years)\n• Turkish Citizenship by Investment\n• Business Visa / Investor Residence\n\n✅ **Steps:**\n1. Consult a lawyer to identify the **right permit type** for your situation.\n2. Gather all required documents (passport, financial proof, health insurance, etc.).\n3. Apply through **e-ikamet.goc.gov.tr** or the relevant government portal.\n4. Attend the **Migration Office appointment**.\n5. If citizenship is the goal, consult on **Citizenship by Investment** options (400K USD real estate held 3 years; or 500K USD converted to **Turkish Lira** via Central Bank and placed in a 3-year TRY fixed deposit — USD/EUR direct deposits no longer qualify).\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🏠 **Residency Appeal / Extension**\n\n🔄 Managing an existing residency matter:\n\n✅ **Steps:**\n1. If denied, file an **administrative appeal** within 60 days.\n2. If overstayed, consult a lawyer immediately to minimize **fines and bans**.\n3. For extensions, apply on **e-ikamet.goc.gov.tr** up to 60 days before expiry.\n4. Update all **supporting documents** (insurance, address, financial proof).\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
  'Real Estate Law': {
    ask: '🏢 **Real Estate Law**\n\nAre you handling a **new** property transaction, or resolving an **ongoing** real estate legal matter?',
    new: '🏢 **Buying Property in Istanbul**\n\nForeigners can own property in Turkey! Here\'s how: 🏡\n\n📋 **Required Steps:**\n• Property valuation (mandatory for foreigners)\n• Title Deed Check (Tapu Sicil Müdürlüğü)\n• Tax Number (Vergi Numarası)\n• Notarized Power of Attorney (if using a lawyer)\n• DASK earthquake insurance\n\n✅ **Steps:**\n1. Engage a licensed **Turkish real estate lawyer (Gayrimenkul Avukatı)**.\n2. Conduct a **title deed (Tapu) search** to verify ownership and liens.\n3. Order an official **property valuation** from a licensed appraiser.\n4. Sign a **Preliminary Sales Agreement (Ön Sözleşme)** and pay deposit.\n5. The **Land Registry (TKGM)** automatically checks for military/security zone restrictions — no separate application needed since 2019. Purchases in actual forbidden zones will be blocked at the registry.\n6. Complete the transfer at the **Tapu Sicil Müdürlüğü** (Land Registry Office).\n7. Purchase **DASK earthquake insurance**.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**',
    renewal: '🏢 **Real Estate Legal Issue Resolution**\n\n🔄 Handling ongoing property matters:\n\n✅ **Steps:**\n1. Consult your **Turkish real estate lawyer** on the specific issue.\n2. For tenant disputes, apply to the **Sulh Hukuk Mahkemesi** (Civil Court of Peace).\n3. For title disputes, file at the **Asliye Hukuk Mahkemesi**.\n4. Renew **DASK insurance** annually.\n5. For rental agreements, ensure they are updated with current legal rent increase caps.\n\n⬇️ **Your full roadmap is being prepared on the Dashboard...**'
  },
};

// ── Dynamic follow-up chips per service (shown after "New Application" is chosen) ──
const SERVICE_AREA_CHIPS: Record<string, { question: string; emoji: string; chips: string[] }> = {
  // Student — location-based (ikamet needs local migration office)
  'ID / İkamet': {
    question: 'Which district is your residence/address in Istanbul? This determines your Migration Office (Göç İdaresi).',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Student Visa': {
    question: 'Which country are you applying from? This determines the Turkish consulate you will visit.',
    emoji: '🌍',
    chips: ['USA', 'UK', 'Germany', 'Russia', 'China', 'Egypt', 'Pakistan', 'Morocco', 'Jordan', 'Saudi Arabia'],
  },
  'Denklik (Equivalency)': {
    question: 'Which country did you graduate from? This helps determine the apostille and translation requirements.',
    emoji: '🎓',
    chips: ['Syria', 'Iraq', 'Egypt', 'Russia', 'Ukraine', 'Pakistan', 'Jordan', 'Germany', 'USA', 'UK'],
  },
  'University Registration': {
    question: 'Which university are you enrolling in?',
    emoji: '🏛️',
    chips: ['Istanbul University', 'Istanbul Technical University', 'Boğaziçi University', 'Marmara University', 'Yıldız Technical University', 'Bahçeşehir University'],
  },
  'Dormitory & Housing': {
    question: 'Which district or area are you looking for accommodation in?',
    emoji: '🏠',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Üsküdar', 'Beyoğlu', 'Eyüpsultan', 'Bakırköy', 'Şişli'],
  },
  'IstanbulKart': {
    question: 'Which area is your university located in? This helps find the nearest IstanbulKart center.',
    emoji: '🚌',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Eyüpsultan', 'Üsküdar', 'Şişli', 'Beyoğlu', 'Bakırköy'],
  },
  // Business / Permit — always needs district
  'Cafe & Restaurant': {
    question: 'Which district in Istanbul will your cafe or restaurant be located in?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Retail Shop': {
    question: 'Which district in Istanbul will your retail shop be located in?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Office & Tech': {
    question: 'Which district in Istanbul will your office be located in?',
    emoji: '🏙️',
    chips: ['Beşiktaş', 'Şişli', 'Levent', 'Maslak', 'Kadıköy', 'Ataşehir', 'Beyoğlu', 'Sarıyer'],
  },
  'Pharmacy': {
    question: 'Which district in Istanbul will your pharmacy be located in?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Clinic': {
    question: 'Which district in Istanbul will your clinic be located in?',
    emoji: '🏙️',
    chips: ['Beşiktaş', 'Şişli', 'Kadıköy', 'Üsküdar', 'Fatih', 'Bakırköy', 'Beyoğlu', 'Ataşehir'],
  },
  'Residence Permit': {
    question: 'Which district in Istanbul is your residence address?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  // Lawyer — context varies
  'Company Formation': {
    question: 'Which district will your company be registered in, or is this an online/remote registration?',
    emoji: '🏢',
    chips: ['Beşiktaş', 'Şişli', 'Kadıköy', 'Fatih', 'Levent / Maslak', 'Ataşehir', 'Online / Remote', 'Not sure yet'],
  },
  'Contract Review': {
    question: 'What type of contract do you need reviewed?',
    emoji: '📑',
    chips: ['Employment Contract', 'Rental Agreement', 'Business Partnership', 'Service Agreement', 'Sales Contract', 'Franchise Agreement', 'NDA / Confidentiality', 'Other'],
  },
  'Employment Law': {
    question: 'What is the employment situation you need help with?',
    emoji: '🤝',
    chips: ['Hiring a new employee', 'Employee termination', 'Salary dispute', 'Work permit for foreigner', 'SGK registration issue', 'Workplace discrimination', 'Contract renewal', 'Other'],
  },
  'Legal Disputes': {
    question: 'What type of legal dispute are you dealing with?',
    emoji: '⚖️',
    chips: ['Business / Commercial', 'Real estate / Property', 'Labor / Employment', 'Contract breach', 'Debt collection', 'Consumer rights', 'Family law', 'Criminal matter'],
  },
  'Residency & Visas': {
    question: 'What type of residency or visa matter do you need legal help with?',
    emoji: '🏠',
    chips: ['Work permit (Çalışma İzni)', 'Long-term residence', 'Citizenship by investment', 'Visa appeal / denial', 'Tourist to resident', 'Family reunion visa', 'Business visa', 'Other'],
  },
  'Real Estate Law': {
    question: 'What type of real estate matter do you need legal help with?',
    emoji: '🏡',
    chips: ['Buying property', 'Selling property', 'Rental dispute', 'Title deed issue', 'Construction dispute', 'Foreign buyer rules', 'Land registry', 'Other'],
  },
};

// Default fallback chips (Istanbul districts) for any unmapped service
const DEFAULT_AREA_CHIPS = [
  'Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu'
];

// ── Dynamic button labels for New vs second option, per service ──
const SERVICE_BUTTON_LABELS: Record<string, { primary: string; secondary: string }> = {
  // Student
  'ID / İkamet':              { primary: '🆕 New Application',      secondary: '🔄 Renewal' },
  'Student Visa':             { primary: '🆕 New Visa',             secondary: '✏️ Extension / Renewal' },
  'Denklik (Equivalency)':    { primary: '🆕 New Application',      secondary: '🔍 Follow-up / Correction' },
  'University Registration':  { primary: '🆕 First-time Registration', secondary: '🔄 Transfer / Re-registration' },
  'Dormitory & Housing':      { primary: '🆕 Find New Housing',      secondary: '🔄 Renew / Change' },
  'IstanbulKart':             { primary: '🆕 Get New Card',          secondary: '🔄 Renew / Reload' },
  // Business / Permit
  'Cafe & Restaurant':        { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Retail Shop':              { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Office & Tech':            { primary: '🆕 Set Up New',           secondary: '🔄 Annual Compliance' },
  'Pharmacy':                 { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Clinic':                   { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Residence Permit':         { primary: '🆕 New Application',      secondary: '🔄 Renewal' },
  // Lawyer
  'Company Formation':        { primary: '🆕 Form New Company',     secondary: '🔄 Restructure / Compliance' },
  'Contract Review':          { primary: '🆕 Review New Contract',  secondary: '✏️ Amend Existing' },
  'Employment Law':           { primary: '🆕 Hire / New Contract',  secondary: '⚠️ Existing Issue' },
  'Legal Disputes':           { primary: '🆕 File New Case',        secondary: '⏳ Ongoing Case / Appeal' },
  'Residency & Visas':        { primary: '🆕 New Matter',           secondary: '🔄 Appeal / Extension' },
  'Real Estate Law':          { primary: '🆕 New Transaction',      secondary: '⚠️ Ongoing Matter' },
};
const DEFAULT_BUTTON_LABELS = { primary: '🆕 New Application', secondary: '🔄 Renewal' };

// ── Localized "ask" questions for the New / Renewal prompt (student services first) ──
const SERVICE_ASK_AR: Record<string, string> = {
  'ID / İkamet':             '🪪 **الإقامة (İkamet)**\n\nلأعطيك الخطوات والمستندات الصحيحة، أحتاج أن أعرف:\n\n**هل هذا طلب إقامة جديد أم تجديد؟**',
  'Student Visa':            '✈️ **تأشيرة الطالب**\n\nيمكنني إرشادك خلال العملية الكاملة! أولاً:\n\n**هل هذا طلب تأشيرة جديدة أم تمديد/تجديد؟**',
  'Denklik (Equivalency)':   '📜 **الدنكليك (معادلة الشهادة)**\n\nلأعطيك التوجيه الصحيح، أحتاج أن أعرف:\n\n**هل هذا طلب دنكليك جديد أم تتابع طلباً سابقاً؟**',
  'University Registration':  '🏛️ **التسجيل الجامعي**\n\nهل تسجل في جامعة تركية **للمرة الأولى**، أم تعيد التسجيل أو تنتقل من جامعة أخرى؟',
  'Dormitory & Housing':      '🛏️ **السكن والمبيت**\n\nهل تبحث عن سكن **للمرة الأولى**، أم تجدد/تغير ترتيبك الحالي؟',
  'IstanbulKart':             '🚌 **إسطنبول كارت (بطاقة المواصلات الطلابية)**\n\nهل تريد **الحصول على بطاقة جديدة**، أم **تجديد/إعادة شحن** بطاقة موجودة؟',
  'Cafe & Restaurant':        '☕ **مقهى ومطعم**\n\nهل تفتح مقهى أو مطعماً **جديداً**، أم تجدد تراخيص **موجودة**؟',
  'Retail Shop':              '🛍️ **محل تجاري**\n\nهل تفتح محلاً **جديداً**، أم تجدد تراخيص محل **موجود**؟',
  'Office & Tech':            '💻 **مكتب وتقنية**\n\nهل تؤسس شركة أو مكتباً **جديداً**، أم تحدث إعداداً **موجوداً**؟',
  'Residence Permit':         '🏠 **تصريح الإقامة**\n\nهل هذا طلب إقامة **جديد**، أم تجديد لإقامة **موجودة**؟',
  'Company Formation':        '🏗️ **تأسيس الشركة**\n\nهل تؤسس شركة **جديدة**، أم تعيد هيكلة كيان **موجود**؟',
  'Contract Review':          '📑 **مراجعة العقد**\n\nهل تراجع عقداً **جديداً**، أم تعدل اتفاقية **موجودة**؟',
  'Legal Disputes':           '⚖️ **النزاعات القانونية**\n\nهل **تبدأ** قضية جديدة، أم تدير نزاعاً **جارياً**؟',
};

const SERVICE_ASK_TR: Record<string, string> = {
  'ID / İkamet':             '🪪 **İkamet (Oturma İzni)**\n\nSize doğru adımları ve belgeleri verebilmem için:\n\n**Bu yeni bir başvuru mu yoksa yenileme mi?**',
  'Student Visa':            '✈️ **Öğrenci Vizesi**\n\nSüreç boyunca size rehberlik edebilirim! Önce:\n\n**Bu yeni bir vize başvurusu mu yoksa uzatma/yenileme mi?**',
  'Denklik (Equivalency)':   '📜 **Denklik (Diploma Denkliği)**\n\nDoğru rehberlik yapabilmem için:\n\n**Bu yeni bir Denklik başvurusu mu yoksa önceki bir başvuruyu mu takip ediyorsunuz?**',
  'University Registration':  '🏛️ **Üniversite Kaydı**\n\nTürkiye\'de bir üniversiteye **ilk kez mi** kayıt yaptırıyorsunuz, yoksa yeniden kayıt veya transfer mi?',
  'Dormitory & Housing':      '🛏️ **Yurt ve Konut**\n\n**İlk kez mi** konut arıyorsunuz yoksa mevcut durumunuzu mu yeniliyorsunuz?',
  'IstanbulKart':             '🚌 **İstanbulKart (Öğrenci Ulaşım Kartı)**\n\n**Yeni bir öğrenci İstanbulKart** almak mı istiyorsunuz yoksa mevcut kartı mı yenilemek/doldurmak?',
};

const SERVICE_BUTTON_LABELS_AR: Record<string, { primary: string; secondary: string }> = {
  'ID / İkamet':             { primary: '🆕 طلب جديد',              secondary: '🔄 تجديد' },
  'Student Visa':            { primary: '🆕 تأشيرة جديدة',          secondary: '✏️ تمديد / تجديد' },
  'Denklik (Equivalency)':   { primary: '🆕 طلب جديد',              secondary: '🔍 متابعة / تصحيح' },
  'University Registration':  { primary: '🆕 تسجيل لأول مرة',       secondary: '🔄 نقل / إعادة تسجيل' },
  'Dormitory & Housing':      { primary: '🆕 ابحث عن سكن جديد',     secondary: '🔄 تجديد / تغيير' },
  'IstanbulKart':             { primary: '🆕 احصل على بطاقة جديدة', secondary: '🔄 تجديد / إعادة شحن' },
  'Cafe & Restaurant':        { primary: '🆕 فتح جديد',             secondary: '🔄 تجديد التراخيص' },
  'Retail Shop':              { primary: '🆕 فتح جديد',             secondary: '🔄 تجديد التراخيص' },
  'Residence Permit':         { primary: '🆕 طلب جديد',             secondary: '🔄 تجديد' },
  'Company Formation':        { primary: '🆕 تأسيس شركة جديدة',     secondary: '🔄 إعادة هيكلة' },
  'Legal Disputes':           { primary: '🆕 رفع قضية جديدة',       secondary: '⏳ قضية جارية / استئناف' },
};

const SERVICE_BUTTON_LABELS_TR: Record<string, { primary: string; secondary: string }> = {
  'ID / İkamet':             { primary: '🆕 Yeni Başvuru',          secondary: '🔄 Yenileme' },
  'Student Visa':            { primary: '🆕 Yeni Vize',             secondary: '✏️ Uzatma / Yenileme' },
  'Denklik (Equivalency)':   { primary: '🆕 Yeni Başvuru',          secondary: '🔍 Takip / Düzeltme' },
  'University Registration':  { primary: '🆕 İlk Kayıt',            secondary: '🔄 Nakil / Yeniden Kayıt' },
  'Dormitory & Housing':      { primary: '🆕 Yeni Konut Bul',       secondary: '🔄 Yenile / Değiştir' },
  'IstanbulKart':             { primary: '🆕 Yeni Kart Al',         secondary: '🔄 Yenile / Doldur' },
};

function getLocalizedAsk(service: string, lang: string): string {
  if (lang === 'ar') return SERVICE_ASK_AR[service] ?? SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
  if (lang === 'tr') return SERVICE_ASK_TR[service] ?? SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
  return SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
}

function getLocalizedBtnLabels(service: string, lang: string) {
  if (lang === 'ar') return SERVICE_BUTTON_LABELS_AR[service] ?? SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
  if (lang === 'tr') return SERVICE_BUTTON_LABELS_TR[service] ?? SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
  return SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
}

// ── Builds a guest-compatible workflow object from SERVICE_FLOW_RESPONSES content ─
const buildGuestWorkflow = (service: string, content: string, area: string, agentType: string) => {
  // Extract bullet-point docs from "📋 Required…" section
  const docsMatch = content.match(/📋[^\n]*\n((?:[^\n]*•[^\n]*\n?)+)/);
  const docs = docsMatch
    ? (docsMatch[1].match(/•\s*([^\n]+)/g) || []).map(d => d.replace(/^•\s*/, '').replace(/\*\*/g, '').trim()).filter(Boolean)
    : [];

  // Extract numbered steps
  const stepLines = content.match(/\n\d+\.[^\n]+/g) || [];
  const steps = stepLines.map((line, i) => {
    const text = line.replace(/^\n\d+\.\s*/, '').replace(/\*\*/g, '').trim();
    return {
      id: i + 1,
      title: text.length > 70 ? text.slice(0, 67) + '…' : text,
      responsible: 'You',
      status: i === 0 ? 'in-progress' : 'pending',
      notes: text,
      docs: i === 0 ? docs : [],
    };
  });

  return {
    service,
    area,
    execution_plan: { steps },
    last_updated: new Date().toISOString(),
    assistant_type: agentType,
    _session_id: null,
  };
};

// Maps English service chip labels → i18n translation keys (for LanguageContext)
const CHIP_I18N_KEY: Record<string, string> = {
  'Cafe & Restaurant':       'chip_cafe_restaurant',
  'Retail Shop':             'chip_retail_shop',
  'Office & Tech':           'chip_office_tech',
  'Pharmacy':                'chip_pharmacy',
  'Clinic':                  'chip_clinic',
  'Residence Permit':        'chip_residence_permit',
  'University Registration': 'chip_uni_reg',
  'ID / İkamet':             'chip_ikamet',
  'Denklik (Equivalency)':   'chip_denklik',
  'Dormitory & Housing':     'chip_dormitory',
  'Student Visa':            'chip_student_visa',
  'IstanbulKart':            'chip_istanbul_kart',
  'Company Formation':       'chip_company_formation',
  'Contract Review':         'chip_contract_review',
  'Employment Law':          'chip_employment_law',
  'Legal Disputes':          'chip_legal_disputes',
  'Residency & Visas':       'chip_residency_visas',
  'Real Estate Law':         'chip_real_estate',
};

// ── Service options per agent — the only suggestions we show. Picking one starts
//    its flow (New/Renewal → district → Dashboard), the fast path to a roadmap. ──
type ServiceOption = { emoji: string; label: string };
const SERVICE_OPTIONS: Record<'permit' | 'student' | 'lawyer', ServiceOption[]> = {
  permit: [
    { emoji: '☕', label: 'Cafe & Restaurant' },
    { emoji: '🛍️', label: 'Retail Shop' },
    { emoji: '💻', label: 'Office & Tech' },
    { emoji: '🏥', label: 'Pharmacy' },
    { emoji: '🩺', label: 'Clinic' },
    { emoji: '🏠', label: 'Residence Permit' },
  ],
  student: [
    { emoji: '🏛️', label: 'University Registration' },
    { emoji: '🪪', label: 'ID / İkamet' },
    { emoji: '📜', label: 'Denklik (Equivalency)' },
    { emoji: '🛏️', label: 'Dormitory & Housing' },
    { emoji: '✈️', label: 'Student Visa' },
    { emoji: '🚌', label: 'IstanbulKart' },
  ],
  lawyer: [
    { emoji: '🏗️', label: 'Company Formation' },
    { emoji: '📑', label: 'Contract Review' },
    { emoji: '🤝', label: 'Employment Law' },
    { emoji: '⚖️', label: 'Legal Disputes' },
    { emoji: '🏠', label: 'Residency & Visas' },
    { emoji: '🏢', label: 'Real Estate Law' },
  ],
};

// Suggestions are intentionally limited to SERVICE_OPTIONS above — picking a
// service starts its flow and drives the client straight to the roadmap. We no
// longer surface tangential follow-up questions (cost/alcohol/etc.) mid-chat.

export default function ChatPage() {
  const router = useRouter();
  const { t, isRTL, language, translateHistory } = useLanguage();
  const { token, isAuthenticated, user, setTokenBalance, lastTokenReset, setIsLoginModalOpen } = useAuth();

  const getRefreshTimeLabel = () => {
    if (quotaRefreshTime) return quotaRefreshTime;
    if (!lastTokenReset) return '12 hours';
    const resetDate = new Date(lastTokenReset);
    resetDate.setHours(resetDate.getHours() + 12);
    return resetDate.toLocaleString(language === 'ar' ? 'ar-SA' : (language === 'tr' ? 'tr-TR' : 'en-US'), {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
  };
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [showQuotaWarning, setShowQuotaWarning] = useState(false);
  const [quotaRefreshTime, setQuotaRefreshTime] = useState('');
  const [assistantType, setAssistantType] = useState<'permit' | 'student' | 'lawyer'>('permit');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showGuestLimitModal, setShowGuestLimitModal] = useState(false);
  const [guestMsgCount, setGuestMsgCount] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Show onboarding instructions on every visit (testing mode — remove condition when done)
  useEffect(() => {
    setShowOnboarding(true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const QUICK_Q = [
    t('chat_q1'),
    t('chat_q2'),
    t('chat_q3'),
    t('chat_q4'),
  ];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [visibleChars, setVisibleChars] = useState<Record<number, number>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [detectedService, setDetectedService] = useState<string | null>(null);
  const [callEnded, setCallEnded] = useState(false);
  const [switchingAgent, setSwitchingAgent] = useState(false);
  const [pendingServiceChoice, setPendingServiceChoice] = useState<string | null>(null);
  const [awaitingAreaService, setAwaitingAreaService] = useState<string | null>(null);
  const [fetchingRoadmap, setFetchingRoadmap] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [dashboardCountdown, setDashboardCountdown] = useState<number | null>(null);
  const [redirectingToDashboard, setRedirectingToDashboard] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hasDashboard, setHasDashboard] = useState(false);
  const [newChatCountdown, setNewChatCountdown] = useState<number | null>(null);
  const newChatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<any>(null);
  const voiceLoopRef = useRef(false);
  const msgIdRef = useRef(1);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const voicesLoadedRef = useRef(false);
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechQueueRef = useRef<string[]>([]);
  const ttsKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpeechQueueActiveRef = useRef(false);
  const typewriterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [fullCleanText, setFullCleanText] = useState('');
  const [spokenWordIndex, setSpokenWordIndex] = useState(-1);

  // Initialize Speech Voices — load early, retry until populated
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const loadVoices = () => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        setAvailableVoices(voices);
        voicesLoadedRef.current = true;
      }
    };

    loadVoices();
    if (synth.onvoiceschanged !== undefined) {
      synth.onvoiceschanged = loadVoices;
    }
    // Fallback polling — some browsers fire onvoiceschanged late
    const poll = setInterval(() => {
      if (!voicesLoadedRef.current) loadVoices();
      else clearInterval(poll);
    }, 300);
    return () => clearInterval(poll);
  }, []);

  // Load sessions on mount or when auth changes
  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      // Check for forced type from dashboard/sidebar
      const forcedType = localStorage.getItem('permitops_assistant_type') as 'permit' | 'student' | 'lawyer' | null;
      if (forcedType) {
        setAssistantType(forcedType);
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/sessions`);
          if (res?.ok) {
            const data = await res.json();
            if (!mounted) return;
            setAllSessions(data);

            // Read what Dashboard requested (if any)
            const forcedSessionId = localStorage.getItem('permitops_ask_step_session');
            if (forcedSessionId) {
              localStorage.removeItem('permitops_ask_step_session');
              const fSession = data.find((s: any) => s.id === forcedSessionId);
              setSessionId(forcedSessionId);
              setSessionTitle(fSession ? (fSession.title || '') : '');
              if (fSession && fSession.assistant_type) {
                setAssistantType(fSession.assistant_type);
              }
              return;
            }

            // Normal load: check if there's a stored active session
            const activeSessionId = localStorage.getItem('permitops_active_session_id');
            const activeSession = data.find((s: any) => s.id === activeSessionId);

            if (activeSession) {
              setSessionId(activeSession.id);
              setSessionTitle(activeSession.title || '');
              // Only override assistant type if no forced type exists
              if (!forcedType && activeSession.assistant_type) {
                setAssistantType(activeSession.assistant_type);
              }
            } else if (!activeSessionId && forcedType) {
              // Redirected from dashboard with a SPECIFIC agent but NO session
              handleNewChat();
            } else if (data.length > 0) {
              setSessionId(data[0].id);
              setSessionTitle(data[0].title || '');
              if (!forcedType && data[0].assistant_type) setAssistantType(data[0].assistant_type);
            } else {
              handleNewChat();
            }
          }
        } catch (e) {
          console.error("Failed to fetch sessions", e);
        }
      } else {
        // Ephemeral GUEST session — unique per visit but not saved in DB
        const existingGuestId = localStorage.getItem('permitops_active_session_id');
        if (existingGuestId && existingGuestId.length > 20) {
          setSessionId(existingGuestId);
        } else {
          const newId = `guest-${Math.random().toString(36).substring(2, 15)}`;
          setSessionId(newId);
          localStorage.setItem('permitops_active_session_id', newId);
        }
      }
    };
    initSession();

    // Load guest message count
    if (!isAuthenticated) {
      const count = parseInt(localStorage.getItem('guest_msg_count_v3') || '0');
      setGuestMsgCount(count);
    }

    return () => { mounted = false; };
  }, [token, isAuthenticated]);

  // Load messages from backend when sessionId changes
  useEffect(() => {
    const loadHistory = async () => {
      const startTime = Date.now();
      if (!sessionId) {
        // Small delay for smooth transition
        await new Promise(r => setTimeout(r, 500));
        setIsLoaded(true);
        return;
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/history/${sessionId}`);
          if (res?.ok) {
            const data = await res.json();
            setMsgs(data);
            if (data.length > 0) {
              msgIdRef.current = Math.max(...data.map((m: any) => m.id)) + 1;
              // Detect if this session already produced a dashboard so we show the
              // "Start new chat" button instead of service chips on reload.
              const alreadyHasDashboard = data.some((m: any) =>
                m.role === 'assistant' &&
                typeof m.content === 'string' &&
                (m.content.includes('roadmap is being prepared on the Dashboard') ||
                 m.content.includes('Opening your Dashboard') ||
                 m.content.includes('roadmap in') ||
                 m.content.includes('⬇️ Opening your Dashboard'))
              );
              if (alreadyHasDashboard) setHasDashboard(true);
              else setHasDashboard(false);
            } else {
              msgIdRef.current = 1;
              setHasDashboard(false);
            }
          }
        } catch (e) {
          console.error("Failed to fetch history from backend", e);
        }
      } else if (sessionId === "default-session") {
        const saved = localStorage.getItem('permitops_chat_history');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) {
              setMsgs(parsed);
              msgIdRef.current = Math.max(...parsed.map((m: Msg) => m.id)) + 1;
            }
          } catch (e) {
            console.error("Failed to parse local chat history", e);
          }
        }
      }

      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

      setIsLoaded(true);
    };
    loadHistory();
  }, [sessionId, token, isAuthenticated]);

  useEffect(() => {
    if (isLoaded && !isAuthenticated && sessionId === "default-session") {
      localStorage.setItem('permitops_chat_history', JSON.stringify(msgs));
    }
    if (sessionId) {
      localStorage.setItem('permitops_active_session_id', sessionId);
      // Use a specific key so Dashboard only updates when a session is set
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }
  }, [msgs, isLoaded, isAuthenticated, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy, visibleChars]);

  // Auto-send a question if navigated from "Ask AI about this step"
  useEffect(() => {
    if (!sessionId || !isLoaded) return;
    const pending = localStorage.getItem('permitops_ask_step');
    if (!pending) return;
    localStorage.removeItem('permitops_ask_step');
    // Small delay so the page settles first
    const timer = setTimeout(() => send(pending, false, true), 600);
    return () => clearTimeout(timer);
  }, [sessionId, isLoaded]);

  const handleNewChat = async (forceType?: string) => {
    const typeToUse = forceType || assistantType;
    if (isAuthenticated && token) {
      try {
        const res = await apiFetch(`/chat/sessions?assistant_type=${typeToUse}`, { method: 'POST' });
        if (res?.ok) {
          const data = await res.json();
          setAllSessions(prev => [data, ...prev]);
          setSessionId(data.id);
          setMsgs([]);
        }
      } catch (e) {
        console.error("Failed to create new session", e);
      }
    } else {
      // Ephemeral GUEST reset
      const newGuestId = `guest-${Math.random().toString(36).substring(2, 15)}`;
      setSessionId(newGuestId);
      localStorage.setItem('permitops_active_session_id', newGuestId);
      clearChat();
    }
    setHasDashboard(false);
    setMsgs([]);
    setSessionTitle('');
  };

  // 3-second countdown then auto-open a new chat of the same agent type
  const triggerNewChatCountdown = () => {
    if (newChatTimerRef.current) return;
    setNewChatCountdown(3);
    newChatTimerRef.current = setInterval(() => {
      setNewChatCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(newChatTimerRef.current!);
          newChatTimerRef.current = null;
          setNewChatCountdown(null);
          handleNewChat();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const switchAssistant = (newType: 'permit' | 'student' | 'lawyer') => {
    if (newType === assistantType) return;

    setSwitchingAgent(true);
    setAssistantType(newType);
    setIsDropdownOpen(false);

    // Give the premium loading screen a moment to shine
    setTimeout(() => {
      // Resume logic: find the most recent session belonging to the requested type
      const recentSession = allSessions.find(s => (s.assistant_type || 'permit') === newType);
      if (recentSession) {
        setSessionId(recentSession.id);
        setSessionTitle(recentSession.title || '');
      } else {
        handleNewChat(newType);
      }

      // Keep loading for at least 1.5s for the wow factor
      setTimeout(() => setSwitchingAgent(false), 1500);
    }, 100);
  };

  // --- Voice Chat Logic ---
  const toggleVoice = () => {
    if (isListening || isVoiceMode) {
      hangUpCall();
    } else {
      startCall();
    }
  };

  const startCall = () => {
    setIsVoiceMode(true);
    setCallEnded(false);
    setCallDuration(0);
    setDetectedService(assistantType); // show chip immediately
    setVoiceTranscript('');
    voiceLoopRef.current = true;
    // Start call timer
    callTimerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);

    // Initial Greeting — short, punchy, human
    const greeting = assistantType === 'student'
      ? "Hey, I'm your student agent. What do you need?"
      : assistantType === 'lawyer'
        ? "Hello, legal agent here. Go ahead."
        : "Hey! Business agent here. What business are you opening?";

    // Small delay for UI transition, then greet immediately
    setTimeout(() => { speak(greeting); }, 400);
  };

  const hangUpCall = () => {
    voiceLoopRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    clearInterval(callTimerRef.current);
    // Clear TTS keepalive
    if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
    setIsListening(false);
    setIsSpeaking(false);
    setCallEnded(true);
    // Push to dashboard after 2s then close
    setTimeout(() => {
      setIsVoiceMode(false);
      setCallEnded(false);
      // Trigger dashboard refresh
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }, 3000);
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Speech recognition not supported in this browser.'); return; }

    // Prime audio context so TTS fires instantly after recognition (no muted-audio glitch)
    try {
      const synth = window.speechSynthesis;
      if (synth && !synth.speaking) {
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        synth.speak(silent);
      }
    } catch (e) { }

    const rec = new SpeechRecognition();
    rec.lang = language === 'tr' ? 'tr-TR' : language === 'ar' ? 'ar-SA' : 'en-US';
    rec.continuous = true;       // phone-call style — keep listening
    rec.interimResults = true;   // show live transcript
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);

    rec.onend = () => {
      setIsListening(false);
      // Auto-restart quickly if still in call and AI isn't speaking
      if (voiceLoopRef.current && !isSpeaking) {
        setTimeout(() => { if (voiceLoopRef.current && !isSpeaking) startListening(); }, 150);
      }
    };

    rec.onerror = (e: any) => {
      if ((e.error === 'no-speech' || e.error === 'aborted') && voiceLoopRef.current) {
        setTimeout(() => { if (voiceLoopRef.current && !isSpeaking) startListening(); }, 200);
      } else if (e.error !== 'not-allowed') {
        setIsListening(false);
      }
    };

    let lastFinalTranscript = '';

    rec.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }

      const liveText = (finalTranscript || interimTranscript).trim();
      if (liveText) setVoiceTranscript(liveText);

      // Live service detection
      const lower = liveText.toLowerCase();
      if (/cafe|coffee|restaurant|shop|retail|office|bakery|pharmacy|gym|barber|permit|ruhsat|محل|مطعم|كافيه/.test(lower)) {
        setDetectedService('permit');
      } else if (/university|student|visa|scholarship|dorm|ikamet|جامعة|طالب|منحة/.test(lower)) {
        setDetectedService('student');
      } else if (/lawyer|contract|company|lawsuit|legal|court|dispute|محامي|عقد|شركة/.test(lower)) {
        setDetectedService('lawyer');
      }

      if (finalTranscript && finalTranscript !== lastFinalTranscript && finalTranscript.length > 2) {
        // Browser confirmed final — send immediately, no silence wait
        lastFinalTranscript = finalTranscript;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        handleUserFinished(finalTranscript);
        return;
      }

      // Interim: start/reset silence timer — 500ms feels like natural call pacing
      if (interimTranscript.length > 2) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (interimTranscript.trim().length > 2) handleUserFinished(interimTranscript.trim());
        }, 500);
      }
    };

    const handleUserFinished = (transcript: string) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setVoiceTranscript('');
      try { rec.stop(); } catch (e) { }
      send(transcript, true);
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch { }
  };

  const stopListening = () => {
    voiceLoopRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  };

  // ── Pick the best available male voice ──────────────────────────────────────
  const pickMaleVoice = (voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null => {
    const searchLangs = [lang, lang.split('-')[0]];
    const inLang = (v: SpeechSynthesisVoice) => searchLangs.some(l => v.lang.startsWith(l));

    // Explicit male names across OS/browser combos — ordered by quality
    const maleKeywords = [
      'Google UK English Male',
      'Microsoft David',
      'Microsoft Mark',
      'Microsoft Guy',
      'Daniel',          // macOS high-quality male EN
      'Aaron',           // macOS male EN-US
      'Google US English',   // usually male-sounding
      'Google UK English',
      'Fred',
      'Alex',
      'Male',
      'man',
      'Guy',
    ];

    for (const kw of maleKeywords) {
      const v = voices.find(v => inLang(v) && v.name.toLowerCase().includes(kw.toLowerCase()));
      if (v) return v;
    }
    // Fallback: any voice in the correct language
    return voices.find(inLang) ?? null;
  };

  // ── Pre-process text for natural, fast TTS ───────────────────────────────────
  const cleanForSpeech = (raw: string): string => raw
    .replace(/\[CTA: .+? \| .+?\]/g, '')           // remove CTA blocks
    .replace(/```[\s\S]*?```/g, '')                  // remove code blocks
    .replace(/`[^`]+`/g, '')                         // remove inline code
    .replace(/#+\s*/g, '')                            // remove markdown headings
    .replace(/[*_~>|]/g, '')                          // remove markdown symbols
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')              // links → label only
    .replace(/!\[.*?\]\(.*?\)/g, '')                 // remove images
    .replace(/\n{2,}/g, '. ')                         // double newline → pause
    .replace(/\n/g, ' ')                              // single newline → space
    .replace(/\s{2,}/g, ' ')                          // collapse whitespace
    .replace(/([.!?])([A-Z])/g, '$1 $2')             // ensure space after sentence
    .trim();

  const speak = (text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    speechQueueRef.current = [];
    isSpeechQueueActiveRef.current = false;

    const cleanText = cleanForSpeech(text);
    setFullCleanText(cleanText);
    setSpokenWordIndex(0);

    // Split into sentences — keeps punctuation, handles ellipsis & abbreviations
    const sentences = cleanText
      .match(/[^.!?\n]+(?:[.!?]+['"]?|$)/g)
      ?.map(s => s.trim())
      .filter(s => s.length > 1) ?? [cleanText];

    speechQueueRef.current = sentences;
    if (speechQueueRef.current.length > 0) processSpeechQueue();
  };

  const processSpeechQueue = () => {
    const synth = window.speechSynthesis;
    if (!synth || speechQueueRef.current.length === 0) {
      isSpeechQueueActiveRef.current = false;
      return;
    }

    isSpeechQueueActiveRef.current = true;
    const text = speechQueueRef.current.shift()!;
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtteranceRef.current = utterance;

    utterance.lang = language === 'tr' ? 'tr-TR' : language === 'ar' ? 'ar-SA' : 'en-US';

    // ── Voice parameters — human-like male, conversational speed ──
    const voices = availableVoices.length > 0 ? availableVoices : synth.getVoices();
    const bestVoice = pickMaleVoice(voices, utterance.lang);
    if (bestVoice) utterance.voice = bestVoice;

    // Natural male prosody — slightly faster than default, deep pitch
    utterance.rate = assistantType === 'lawyer' ? 1.05 : 1.12;   // conversational fast
    utterance.pitch = assistantType === 'lawyer' ? 0.80 : 0.85;   // deep male tone
    utterance.volume = 1.0;

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        // Find which sentence we are in and add the word index
        const spokenTextSoFar = text.substring(0, event.charIndex);
        const wordCountInSentence = spokenTextSoFar.split(/\s+/).filter(Boolean).length;

        // Find overall index in fullCleanText
        const previousSentencesText = cleanForSpeech(text).split(text)[0] || ""; // This is tricky
        // Simpler: just use a ref to track total words spoken so far in this session
        setSpokenWordIndex(prev => prev + 1);
      }
    };

    utterance.onstart = () => {
      setIsSpeaking(true);
      // Stop mic while AI speaks to prevent echo
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch { }
      // ── Chrome TTS keepalive: Chrome silently pauses synth after ~15s ──
      // Calling pause()+resume() every 12s kicks it back alive without interrupting speech.
      if (ttsKeepaliveRef.current) clearInterval(ttsKeepaliveRef.current);
      ttsKeepaliveRef.current = setInterval(() => {
        const s = window.speechSynthesis;
        if (s && s.speaking) { s.pause(); s.resume(); }
        else if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
      }, 12000);
    };

    utterance.onend = () => {
      if (speechQueueRef.current.length > 0) {
        processSpeechQueue(); // immediately chain next sentence
      } else {
        // All sentences done — clear keepalive
        if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
        setIsSpeaking(false);
        setSpokenWordIndex(-1);
        currentUtteranceRef.current = null;
        // Resume listening quickly — feels like a live call
        if (voiceLoopRef.current) {
          setTimeout(() => { if (voiceLoopRef.current) startListening(); }, 120);
        }
      }
    };

    utterance.onerror = (e: any) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return; // normal cancel
      console.warn('TTS error — skipping sentence:', e.error);
      if (ttsKeepaliveRef.current) { clearInterval(ttsKeepaliveRef.current); ttsKeepaliveRef.current = null; }
      setIsSpeaking(false);
      currentUtteranceRef.current = null;
      if (speechQueueRef.current.length > 0) processSpeechQueue();
      else if (voiceLoopRef.current) {
        setTimeout(() => { if (voiceLoopRef.current) startListening(); }, 120);
      }
    };

    synth.speak(utterance);
  };

  const handleDeleteSession = async (id: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`/chat/history/${id}?token=${token}`, { method: 'DELETE' });
      if (res?.ok) {
        setAllSessions(prev => prev.filter((s: any) => s.id !== id));
        if (sessionId === id) setSessionId(null);
        else setSessionId(prev => prev);
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const handleToggleFavorite = async (id: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`/chat/sessions/${id}/favorite`, { method: 'POST' });
      if (res?.ok) {
        setSidebarRefresh(prev => prev + 1);
      }
    } catch (e) {
      console.error("Failed to toggle favorite", e);
    }
  };

  const saveMessagesToHistory = async (
    messages: { role: 'user' | 'assistant'; content: string }[],
    service?: string,
    flowType?: 'new' | 'renewal'
  ) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/chat/history/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, service, flow_type: flowType }),
      });
      if (res?.ok) {
        const data = await res.json();
        if (data.session_title && data.session_title !== sessionTitle) {
          setSessionTitle(data.session_title);
        }
        setSidebarRefresh(prev => prev + 1);
        
        // Trigger dashboard refresh
        localStorage.setItem('permitops_workflow_update', Date.now().toString());
        window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
      }
    } catch (e) {
      console.error("Failed to save messages to history", e);
    }
  };

  const handleAreaSubmit = async (areaName: string) => {
    if (!awaitingAreaService || busy || !sessionId) return;
    const service = awaitingAreaService;
    setAwaitingAreaService(null);

    // Add user message to UI
    const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: areaName };
    setMsgs(p => [...p, userMsg]);
    setBusy(true);

    try {
      const serviceAssistantType =
        ['ID / İkamet', 'Student Visa', 'Denklik (Equivalency)', 'University Registration', 'Dormitory & Housing', 'IstanbulKart'].includes(service) ? 'student' :
        ['Company Formation', 'Contract Review', 'Employment Law', 'Legal Disputes', 'Residency & Visas', 'Real Estate Law'].includes(service) ? 'lawyer' : 'permit';

      // Insert assistant confirmation message with actual dynamic steps
      const flow = SERVICE_FLOW_RESPONSES[service];
      const stepsText = flow?.new || (
        language === 'tr'
          ? `🏛️ **${service} Yeni Başvuru**\n\nYol haritanız hazırlanıyor...`
          : language === 'ar'
          ? `🏛️ **${service} طلب جديد**\n\nيتم إعداد خارطة الطريق الخاصة بك...`
          : `🏛️ **New ${service} Application**\n\nYour roadmap is being prepared...`
      );

      const stepsMsgId = msgIdRef.current++;
      setMsgs(p => [...p, { id: stepsMsgId, role: 'assistant', content: stepsText }]);

      const body = JSON.stringify({
        query: `${service} - New Application in ${areaName}`,
        language: language,
        context: { session_id: sessionId },
        assistant_type: serviceAssistantType,
        save_history: false
      });

      localStorage.setItem('permitops_active_session_id', sessionId);
      localStorage.setItem('permitops_assistant_type', serviceAssistantType);

      // Start the query in the background immediately
      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });

      if (!res || !res.ok) throw new Error("Failed to generate workflow steps");

      // Save messages to history
      await saveMessagesToHistory([
        { role: 'user', content: areaName },
        { role: 'assistant', content: stepsText }
      ], service, 'new');

      // Trigger dashboard reload event
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));

      // Save workflow locally so guests can see steps on the dashboard
      const guestWorkflow = buildGuestWorkflow(service, stepsText, areaName, serviceAssistantType);
      localStorage.setItem('permitops_guest_workflow', JSON.stringify(guestWorkflow));

      // Show loading screen immediately, navigate to dashboard after 2s
      setFetchingRoadmap(true);
      setTimeout(() => {
        setFetchingRoadmap(false);
        setBusy(false);
        router.push('/dashboard');
      }, 2000);

    } catch (err) {
      console.error(err);
      setFetchingRoadmap(false);
      setBusy(false);
      setMsgs(p => [...p, {
        id: msgIdRef.current++,
        role: 'assistant',
        content: language === 'tr'
          ? "⚠️ Yol haritası oluşturulurken bir hata oluştu. Lütfen tekrar deneyin."
          : language === 'ar'
          ? "⚠️ حدث خطأ أثناء إنشاء خارطة الطريق. يرجى المحاولة مرة أخرى."
          : "⚠️ Error occurred while generating the roadmap. Please try again."
      }]);
    }
  };

  const handleRenewalSubmit = async (service: string) => {
    if (busy || !sessionId) return;
    setBusy(true);

    try {
      const serviceAssistantType =
        ['ID / İkamet', 'Student Visa', 'Denklik (Equivalency)', 'University Registration', 'Dormitory & Housing', 'IstanbulKart'].includes(service) ? 'student' :
        ['Company Formation', 'Contract Review', 'Employment Law', 'Legal Disputes', 'Residency & Visas', 'Real Estate Law'].includes(service) ? 'lawyer' : 'permit';

      // Insert assistant loading confirmation message
      const loadingMsgId = msgIdRef.current++;
      const loadingText = language === 'tr'
        ? `🔄 Yenileme işlemleri analiz ediliyor...`
        : language === 'ar'
        ? `🔄 يتم تحليل إجراءات التجديد...`
        : `🔄 Analyzing renewal procedures...`;

      setMsgs(p => [...p, { id: loadingMsgId, role: 'assistant', content: loadingText }]);

      // Enable the fullscreen loading page overlay for fetching transition
      setFetchingRoadmap(true);

      const body = JSON.stringify({
        query: `${service} - Renewal`,
        language: language,
        context: { session_id: sessionId },
        assistant_type: serviceAssistantType,
        save_history: false
      });

      localStorage.setItem('permitops_active_session_id', sessionId);
      localStorage.setItem('permitops_assistant_type', serviceAssistantType);

      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });

      if (!res || !res.ok) throw new Error("Failed to generate workflow steps");

      // Save messages to history
      await saveMessagesToHistory([
        { role: 'assistant', content: loadingText }
      ], service, 'renewal');

      // Trigger dashboard reload event
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));

      // Wait a moment for UX smoothness and animation
      setTimeout(() => {
        setFetchingRoadmap(false);
        setBusy(false);
        router.push('/dashboard');
      }, 1500);

    } catch (err) {
      console.error(err);
      setFetchingRoadmap(false);
      setBusy(false);
      setMsgs(p => [...p, {
        id: msgIdRef.current++,
        role: 'assistant',
        content: language === 'tr'
          ? "⚠️ Yol haritası oluşturulurken bir hata oluştu. Lütfen tekrar deneyin."
          : language === 'ar'
          ? "⚠️ حدث خطأ أثناء إنشاء خارطة الطريق. يرجى المحاولة مرة أخرى."
          : "⚠️ Error occurred while generating the roadmap. Please try again."
      }]);
    }
  };

  // Start a service: if it has a New/Renewal flow, show that question in chat;
  // otherwise send it as a query. Shared by the empty-state cards and the
  // Suggested-mode service strip — the single entry point into a service flow.
  const startService = (label: string) => {
    if (RENEWAL_SERVICES.includes(label) && SERVICE_FLOW_RESPONSES[label]) {
      const flow = SERVICE_FLOW_RESPONSES[label];
      const askText = getLocalizedAsk(label, language);
      const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: label };
      const askId = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [askId]: 0 }));
      setMsgs(p => [...p, userMsg, { id: askId, role: 'assistant', content: askText }]);
      setAwaitingAreaService(null);
      setPendingServiceChoice(label);
      let chars = 0;
      const interval = setInterval(() => {
        chars += 15;
        setVisibleChars(prev => ({ ...prev, [askId]: chars }));
        if (chars >= askText.length) clearInterval(interval);
      }, 30);
      setSessionTitle(label);
      saveMessagesToHistory([
        { role: 'user', content: label },
        { role: 'assistant', content: askText },
      ], label);
    } else {
      send(label);
    }
  };

  const send = async (text?: string, isFromVoice: boolean = false, isStepQuery: boolean = false) => {
    const q = (text ?? input).trim();
    if ((!q && !file) || busy || !sessionId) return;

    if (awaitingAreaService) {
      setInput('');
      handleAreaSubmit(q);
      return;
    }

    const wasListening = isListening; // Capture state before potential reset
    setInput('');
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeaking(false);

    const displayQ = file ? `📎 [Attached: ${file.name}]\n${q}` : q;
    const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: displayQ };
    setMsgs(p => [...p, userMsg]);

    // ── Dashboard session lock — only step queries are allowed ──────────────
    if (hasDashboard && !isStepQuery) {
      const blockMsg = language === 'tr'
        ? '📊 Bu sohbette yalnızca dashboard adımları hakkında soru sorabilirsiniz. Yeni bir hizmet için lütfen yeni bir sohbet başlatın 👇'
        : language === 'ar'
        ? '📊 في هذه المحادثة، يمكنك فقط طرح أسئلة حول خطوات لوحة التحكم. لبدء خدمة جديدة، يرجى إنشاء محادثة جديدة 👇'
        : '📊 You can only ask about the steps in this chat. To start a new service, please **create a new chat** 👇';
      const blockId = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [blockId]: 0 }));
      setMsgs(p => [...p, { id: blockId, role: 'assistant', content: blockMsg }]);
      let chars = 0;
      const iv = setInterval(() => {
        chars += 20;
        setVisibleChars(prev => ({ ...prev, [blockId]: chars }));
        if (chars >= blockMsg.length) clearInterval(iv);
      }, 30);
      return;
    }

    // ── Canned response check for quick topics — instant answer, no API call ──
    const canned = CANNED_RESPONSES[q.trim()];
    
    if (canned && !file) {
      const cannedId = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [cannedId]: 0 }));
      setMsgs(p => [...p, { id: cannedId, role: 'assistant', content: canned }]);
      let chars = 0;
      const interval = setInterval(() => {
        chars += 15; // Fast animation for mobile
        setVisibleChars(prev => ({ ...prev, [cannedId]: chars }));
        if (chars >= canned.length) clearInterval(interval);
      }, 30);
      setBusy(false);
      saveMessagesToHistory([
        { role: 'user', content: displayQ },
        { role: 'assistant', content: canned }
      ]);
      return;
    }

    // Guest message limit logic
    if (!isAuthenticated) {
      const newCount = guestMsgCount + 1;
      setGuestMsgCount(newCount);
      localStorage.setItem('guest_msg_count_v3', newCount.toString());

      if (newCount > 10) {
        setIsLoginModalOpen(true);
        setInput(q); // Restore input so they don't lose it
        setBusy(false);
        return;
      }
    }
    if (user?.subscriptionStatus === 'free' && (user.tokenBalance ?? 0) <= 0) {
      setShowQuotaWarning(true);
      // We don't have the refresh time locally here easily without a previous 403, 
      // but we can just show the generic message.
      return;
    }

    setBusy(true);
    if (!sessionTitle && msgs.length === 0) {
      setSessionTitle(q.length > 35 ? q.slice(0, 32) + '...' : q || "Document Analysis");
    }

    const currentFile = file;
    setFile(null);

    try {
      let body;
      let headers: HeadersInit = {};

      if (currentFile) {
        const formData = new FormData();
        formData.append('query', q);
        formData.append('language', language);
        formData.append('session_id', sessionId);
        if (token) formData.append('token', token);
        formData.append('file', currentFile);
        formData.append('assistant_type', assistantType);
        body = formData;
        // Browser sets Content-Type multipart/form-data boundary automatically
      } else {
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({
          query: q,
          language,
          context: { session_id: sessionId },
          assistant_type: assistantType,
          is_step_query: isStepQuery,
          history: msgs.map(m => ({ role: m.role, content: m.content }))
        });
      }

      // Create abort controller for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (res?.status === 403) {
        const errorData = await res.json();
        const detail = errorData.detail || "";
        const [title, refreshTime] = detail.includes('|') ? detail.split('|') : ["Model quota reached", "shortly"];

        setQuotaRefreshTime(refreshTime);
        setShowQuotaWarning(true);
        setBusy(false);
        return;
      }

      if (res?.status === 429) {
        setMsgs(p => [...p, {
          id: msgIdRef.current++,
          role: 'assistant',
          content: "⚠️ **Too many requests.**\n\nYou're sending messages too fast. Please wait a moment before trying again."
        }]);
        setBusy(false);
        return;
      }

      if (!res || !res.ok) throw new Error();
      const data = await res.json();
      const source = data.source || "Unknown";
      console.log(`%c[Data Message Source] %c${source}`, "color: #3b82f6; font-weight: bold", "color: inherit", { assistant: assistantType, session: sessionId, data });

      // Update token balance if returned
      if (data.token_balance !== undefined) {
        setTokenBalance(data.token_balance);
      } else if (user?.subscriptionStatus === 'free' && user.tokenBalance !== undefined) {
        setTokenBalance(Math.max(0, user.tokenBalance - 1));
      }

      if (data.session_title && data.session_title !== sessionTitle) {
        setSessionTitle(data.session_title);
        setSidebarRefresh(prev => prev + 1);
      }

      let rawContent: string = data.content ?? data.answer ?? data.response ?? 'Done.';

      // Clean up any leaked source prefixes from the text (e.g. [Backup Core], [Direct Reply])
      rawContent = rawContent.replace(/^🛡️?\s*\[.*?\]\s*/, '').trim();

      // Detect topic-switch redirect signal
      if (rawContent.startsWith('REDIRECT_NEW_CHAT:')) {
        const parts = rawContent.replace('REDIRECT_NEW_CHAT:', '').split('|');
        const targetType = parts[0]?.trim() as any;
        const displayMsg = parts[1]?.trim() || parts[0]?.trim();

        setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: displayMsg }]);
        setBusy(false);
        // Auto-navigate to a new chat after 2 seconds
        setTimeout(async () => {
          if (['permit', 'student', 'lawyer'].includes(targetType)) {
            setAssistantType(targetType);
          }
          await handleNewChat();
          setMsgs([]);
        }, 2000);
        return;
      }

      // Not understood / off-topic — show redirect message and snap back to suggestion mode
      if (rawContent.startsWith('NOT_UNDERSTOOD:')) {
        const msg = rawContent.slice('NOT_UNDERSTOOD:'.length).trim();
        const msgId = msgIdRef.current++;
        setVisibleChars(prev => ({ ...prev, [msgId]: 0 }));
        setMsgs(p => [...p, { id: msgId, role: 'assistant', content: msg }]);
        setShowTextInput(false); // ensure suggestion chips are visible
        setBusy(false);
        let chars = 0;
        const iv = setInterval(() => {
          chars += 20;
          setVisibleChars(prev => ({ ...prev, [msgId]: chars }));
          if (chars >= msg.length) clearInterval(iv);
        }, 30);
        return;
      }

      // Student service auto-detected from typed text (e.g. "ikamet", "denklik", "vize").
      // Triggers the same New / Renewal flow as clicking the service chip — no extra
      // user message added since the typed query is already in msgs.
      if (rawContent.startsWith('STUDENT_SERVICE_READY:')) {
        const label = rawContent.slice('STUDENT_SERVICE_READY:'.length).trim();
        if (RENEWAL_SERVICES.includes(label) && SERVICE_FLOW_RESPONSES[label]) {
          const askText = getLocalizedAsk(label, language);
          const askId = msgIdRef.current++;
          setVisibleChars(prev => ({ ...prev, [askId]: 0 }));
          setMsgs(p => [...p, { id: askId, role: 'assistant', content: askText }]);
          setAwaitingAreaService(null);
          setPendingServiceChoice(label);
          let chars = 0;
          const interval = setInterval(() => {
            chars += 15;
            setVisibleChars(prev => ({ ...prev, [askId]: chars }));
            if (chars >= askText.length) clearInterval(interval);
          }, 30);
          setSessionTitle(label);
          saveMessagesToHistory([{ role: 'user', content: q }, { role: 'assistant', content: askText }], label);
          return;
        }
      }

      const assistantMsgId = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [assistantMsgId]: 0 }));
      setMsgs(p => [...p, { id: assistantMsgId, role: 'assistant', content: rawContent }]);

      // Start typewriter effect — smooth: 45 chars per 30ms ≈ 1,500 chars/sec (33fps)
      let chars = 0;
      const total = rawContent.length;
      if (typewriterIntervalRef.current) clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = setInterval(() => {
        chars += 45;
        setVisibleChars(prev => ({ ...prev, [assistantMsgId]: chars }));
        if (chars >= total) {
          clearInterval(typewriterIntervalRef.current!);
          typewriterIntervalRef.current = null;
        }
      }, 30);

      // Auto-speak if it was a voice query or we are in call mode
      if (isVoiceMode || isFromVoice || wasListening) {
        speak(rawContent);
        setVoiceTranscript("");
      }

      // Guided flow collected business + district → roadmap ready.
      // Show the summary, then open the Dashboard after 3 seconds.
      if (data.dashboard_state) {
        setHasDashboard(true);
        try {
          localStorage.setItem('permitops_active_session_id', sessionId);
          localStorage.setItem('permitops_assistant_type', assistantType);
          // Guests/offline read the workflow from localStorage on the dashboard.
          localStorage.setItem('permitops_guest_workflow', JSON.stringify(data.dashboard_state));
          localStorage.setItem('permitops_workflow_update', Date.now().toString());
          window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
        } catch { /* ignore storage errors */ }
        setTimeout(() => {
          setFetchingRoadmap(true);
          router.push('/dashboard');
        }, 3000);
      }
    } catch {
      setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: "⚠️ Backend is currently offline. Please make sure the server is running." }]);
    } finally {
      setBusy(false);
    }
  };

  const cancelResponse = () => {
    // Abort in-flight fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Stop typewriter
    if (typewriterIntervalRef.current) {
      clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
    // Append cancelled notice to last assistant message (or add new one)
    setMsgs(prev => {
      const lastAssistant = [...prev].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        return prev.map(m =>
          m.id === lastAssistant.id
            ? { ...m, content: m.content.trim() + '\n\n*Response cancelled.*' }
            : m
        );
      }
      return [...prev, { id: msgIdRef.current++, role: 'assistant', content: '*Response cancelled.*' }];
    });
    // Show full content of last message (stop typewriter clipping)
    setVisibleChars(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(k => { updated[Number(k)] = 999999; });
      return updated;
    });
    setBusy(false);
  };

  const clearChat = async () => {
    if (isAuthenticated && token && sessionId) {
      try {
        await apiFetch(`/chat/history/${sessionId}`, { method: 'DELETE' });
        setSessionId(null);
      } catch (e) {
        console.error("Failed to clear history on backend", e);
      }
    } else {
      localStorage.removeItem('permitops_chat_history');
      setMsgs([]);
      msgIdRef.current = 1;
    }
  };

  const isEmpty = msgs.length === 0;

  if (!isLoaded || switchingAgent || fetchingRoadmap) return <LoadingScreen agentType={assistantType} branded={false} />;

  return (
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)] transition-colors duration-500">
      <AnimatePresence>
        {showOnboarding && (
          <OnboardingWizard
            onDismiss={() => {
              localStorage.setItem('turkgateway_onboarding_done', 'true');
              setShowOnboarding(false);
            }}
          />
        )}
      </AnimatePresence>


      {/* Dynamic Background — uses CSS vars so it auto-adapts to dark mode */}
      <div className="absolute inset-0 bg-[var(--bg)] pointer-events-none transition-colors duration-500" />
      <Sidebar
        currentSessionId={sessionId}
        assistantType={assistantType}
        onSessionSelect={(id, title) => { setSessionId(id); setSessionTitle(title); setHasDashboard(false); setMsgs([]); }}
        onNewChat={() => handleNewChat()}
        onDeleteSession={handleDeleteSession}
        onToggleFavorite={handleToggleFavorite}
        token={token}
        onSwitchAssistant={switchAssistant}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        refreshTrigger={sidebarRefresh}
      />

      <main className={`flex-1 flex flex-col min-w-0 transition-colors duration-300 relative border-[var(--border)] ${isRTL ? 'border-r' : 'border-l'}`}>
        {/* Desktop Navbar with Agent Selector */}
        <div className="hidden md:block">
          <Navbar
            isAppPage
            extraContent={
              <div className="relative" ref={dropdownRef}>
                <div
                  className={`flex items-center gap-1.5 cursor-pointer px-3 py-1.5 rounded-full transition-all border glass-mesh shadow-lg group hover:scale-[1.02] active:scale-95 ${assistantType === 'student' ? 'border-emerald-500/20 mesh-green shadow-emerald-500/10' :
                    assistantType === 'lawyer' ? 'border-amber-500/20 mesh-amber shadow-amber-500/10' :
                      'border-blue-500/20 mesh-blue shadow-blue-500/10'
                    }`}
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <div className="relative flex items-center justify-center">
                    <Cpu size={12} className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                        'text-blue-500'
                      }`} />
                    <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${assistantType === 'student' ? 'bg-emerald-500/30' :
                      assistantType === 'lawyer' ? 'bg-amber-500/30' :
                        'bg-blue-500/30'
                      }`} />
                  </div>
                  <span className={`font-black uppercase tracking-[0.1em] ${assistantType === 'student' ? 'text-emerald-500' :
                    assistantType === 'lawyer' ? 'text-amber-500' :
                      'text-blue-500'
                    }`} style={{ fontSize: 'clamp(9px, 0.7vw, 11px)' }}>
                    {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
                  </span>
                  <ChevronDown size={10} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''} ${assistantType === 'student' ? 'text-emerald-400 group-hover:text-emerald-500' :
                    assistantType === 'lawyer' ? 'text-amber-400 group-hover:text-amber-500' :
                      'text-blue-400 group-hover:text-blue-500'
                    }`} />
                </div>

                <AnimatePresence mode="wait">
                  {isDropdownOpen && (
                    <motion.div
                      key="desktop-dropdown"
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-60 bg-[var(--surface)]/90 border border-white/10 rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.3)] z-[100] overflow-hidden backdrop-blur-2xl"
                    >
                      <div className="p-2 space-y-1">
                        <div className="px-3 py-1.5 mb-2 text-[10px] font-bold text-[var(--muted)] opacity-50 uppercase tracking-widest border-b border-white/5">
                          Switch Assistant
                        </div>
                        <button
                          onClick={() => switchAssistant('permit')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'permit' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'permit' ? 'bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'permit' ? 'text-white' : 'text-blue-500'}`} />
                            {assistantType === 'permit' && <div className="absolute inset-0 bg-blue-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_permit')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('student')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500'}`} />
                            {assistantType === 'student' && <div className="absolute inset-0 bg-emerald-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_student')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('lawyer')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'lawyer' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'lawyer' ? 'bg-amber-500 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'lawyer' ? 'text-white' : 'text-amber-500'}`} />
                            {assistantType === 'lawyer' && <div className="absolute inset-0 bg-amber-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_lawyer')}</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
          />
        </div>

        {/* Mobile Top Bar — Ultra-clean agent selection overlay */}
        <div className="flex md:hidden items-center justify-between px-5 h-16 shrink-0 bg-[var(--bg)]/80 backdrop-blur-xl border-b border-white/5 z-[60]">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-[var(--text)] active:scale-95 transition-all"
          >
            <Menu size={20} />
          </button>

          <div
            className="flex flex-col items-center justify-center cursor-pointer group"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border active:scale-95 transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
              assistantType === 'lawyer' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                'bg-blue-500/10 border-blue-500/20 text-blue-500'
              }`}>
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
              </span>
              <ChevronDown size={10} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {isAuthenticated && user?.subscriptionStatus !== 'free' && (
              <span className="text-[10px] font-black text-emerald-500 mt-0.5 tracking-widest uppercase">
                PREMIUM
              </span>
            )}

          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[13px] font-bold shadow-lg shadow-indigo-500/20">
                {(user.fullName || user.email || 'U')[0].toUpperCase()}
              </div>
            ) : (
              <Link href="/login" className="w-9 h-9 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                <User size={16} className="text-[var(--text)]" />
              </Link>
            )}
          </div>
        </div>

        <div className="hidden md:block h-0 shrink-0" />

        {/* Gemini-Style Content Header */}
        <div className="flex flex-col items-center justify-center pt-8 pb-2 md:pt-12 md:pb-4 xl:pt-16 shrink-0 z-30 relative px-4 text-center">
          <span className="font-bold text-[var(--text)] opacity-95 tracking-tight leading-tight" style={{ fontSize: 'clamp(16px, 1.5vw, 22px)' }}>
            {(() => {
              if (!sessionTitle || msgs.length === 0 || sessionTitle === t('chat_new')) return t('chat_new');
              const match = sessionTitle.toLowerCase().match(/^(.+?)\s+in\s+(.+)$/);
              if (match) {
                const bizKey = `biz_${match[1].trim()}`;
                const distKey = `dist_${match[2].trim().replace(/\s/g, '').toLowerCase()}`;
                const lb = t(bizKey), ld = t(distKey);
                if (lb !== bizKey && ld !== distKey) return `${lb} ${t('connect_in')} ${ld}`;
              }
              return sessionTitle;
            })()}
          </span>
        </div>

        {/* Agent Selection Dropdown — renders on both mobile & desktop */}
        <AnimatePresence mode="wait">
          {isDropdownOpen && (
            <motion.div key="mobile-dropdown-wrapper">
              {/* Backdrop Blur */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 backdrop-blur-md z-[90]"
                onClick={() => setIsDropdownOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.05, y: 20 }}
                className="fixed top-24 md:top-28 left-1/2 -translate-x-1/2 bg-[var(--surface-1)]/98 border border-white/10 rounded-[32px] shadow-[0_40px_100px_rgba(0,0,0,0.7)] p-4 w-[90vw] max-w-[360px] z-[100] flex flex-col gap-3 overflow-hidden backdrop-blur-3xl"
              >
                <div className="px-5 py-2.5 border-b border-white/5 mb-2 text-center font-black uppercase tracking-[0.2em] text-[12px] text-[var(--text)] opacity-40">
                  {t('chat_switch_assistant')}
                </div>

                <div className="flex flex-col gap-2.5 md:gap-3 px-2">
                  <button
                    onClick={() => switchAssistant('permit')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'permit' ? 'bg-blue-500/10 border border-blue-500/30 shadow-[0_8px_30px_rgba(59,130,246,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-blue-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'permit' ? 'bg-blue-500 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-500 group-hover:border-blue-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'permit' ? 'text-white' : 'text-blue-500 group-hover:text-white'}`} />
                      {(assistantType === 'permit' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'permit' ? 'bg-blue-400' : 'bg-blue-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_permit')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_permit_desc')}</span>
                    </div>
                    {assistantType === 'permit' && <div className="ml-auto w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('student')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'student' ? 'bg-emerald-500/10 border border-emerald-500/30 shadow-[0_8px_30px_rgba(16,185,129,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-emerald-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:border-emerald-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500 group-hover:text-white'}`} />
                      {(assistantType === 'student' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'student' ? 'bg-emerald-400' : 'bg-emerald-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_student')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_student_desc')}</span>
                    </div>
                    {assistantType === 'student' && <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('lawyer')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'lawyer' ? 'bg-amber-500/10 border border-amber-500/30 shadow-[0_8px_30px_rgba(245,158,11,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-amber-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'lawyer' ? 'bg-amber-500 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20 group-hover:bg-amber-500 group-hover:border-amber-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'lawyer' ? 'text-white' : 'text-amber-500 group-hover:text-white'}`} />
                      {(assistantType === 'lawyer' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'lawyer' ? 'bg-amber-400' : 'bg-amber-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_lawyer')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_lawyer_desc')}</span>
                    </div>
                    {assistantType === 'lawyer' && <div className="ml-auto w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_#f59e0b]" />}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">

          {isEmpty ? (
            <div className="flex-1 flex flex-col max-w-4xl xl:max-w-5xl mx-auto w-full px-5 md:px-6 xl:px-10 overflow-y-auto no-scrollbar">
              <div className="my-auto flex flex-col w-full shrink-0 pt-2 pb-8">
              {/* Welcome Message — Cinematic AI Entrance */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                className="flex flex-col items-center justify-center text-center px-4 pt-0 md:pt-2 mb-2 md:mb-4 xl:mb-10"
              >
                <div className="relative mb-4 md:mb-4">
                  {/* Holographic scanning grid area */}
                  <div className="absolute inset-[-60px] rounded-full overflow-hidden pointer-events-none opacity-20">
                    <div className="absolute inset-0" style={{
                      backgroundImage: `radial-gradient(circle, ${assistantType === 'student' ? 'rgba(16,185,129,0.4)' :
                        assistantType === 'lawyer' ? 'rgba(245,158,11,0.4)' :
                          'rgba(59,130,246,0.4)'
                        } 1px, transparent 1px)`,
                      backgroundSize: '16px 16px'
                    }} />
                  </div>

                  {/* Primary holographic ring */}
                  <motion.div
                    animate={{
                      rotate: 360,
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      rotate: { duration: 12, repeat: Infinity, ease: "linear" },
                      scale: { duration: 4, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-15px] md:inset-[-25px] rounded-[35%] border-[1.5px] border-dashed border-red-500/40 blur-[1px]"
                  />

                  {/* Counter-rotating technical ring */}
                  <motion.div
                    animate={{
                      rotate: -360,
                      scale: [1.1, 1, 1.1],
                    }}
                    transition={{
                      rotate: { duration: 18, repeat: Infinity, ease: "linear" },
                      scale: { duration: 5, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-25px] md:inset-[-40px] rounded-full border-t border-b border-red-500/20"
                  />

                  {/* Floating technical particles (Orbital Swarm) */}
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        x: [
                          Math.cos(i * 30) * 50,
                          Math.cos(i * 30 + 120) * 70,
                          Math.cos(i * 30 + 240) * 50,
                          Math.cos(i * 30) * 50
                        ],
                        y: [
                          Math.sin(i * 30) * 50,
                          Math.sin(i * 30 + 120) * 70,
                          Math.sin(i * 30 + 240) * 50,
                          Math.sin(i * 30) * 50
                        ],
                        opacity: [0, 0.7, 0.3, 0.7, 0],
                        scale: [0, 1.2, 0.8, 1.2, 0]
                      }}
                      transition={{
                        duration: 5 + (i * 0.7),
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className={`absolute rounded-full blur-[0.4px] pointer-events-none ${i % 4 === 0 ? 'bg-white w-0.5 h-0.5' :
                        assistantType === 'student' ? 'bg-emerald-400/60 w-1 h-1 shadow-[0_0_5px_rgba(16,185,129,0.5)]' :
                          assistantType === 'lawyer' ? 'bg-amber-400/60 w-1 h-1 shadow-[0_0_5px_rgba(245,158,11,0.5)]' :
                            'bg-blue-400/60 w-1 h-1 shadow-[0_0_5px_rgba(59,130,246,0.5)]'
                        }`}
                    />
                  ))}

                  {/* Outer breathing aura */}
                  <motion.div
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 0.6, 0.3]
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                    className={`absolute inset-[-60px] rounded-full blur-[80px] ${assistantType === 'student' ? 'bg-emerald-600/10' :
                      assistantType === 'lawyer' ? 'bg-amber-600/10' :
                        'bg-blue-600/10'
                      }`}
                  />



                  {/* The Chip Unit */}
                  <motion.div
                    whileHover={{
                      scale: 1.05,
                      rotateY: 10,
                      rotateX: -10,
                      boxShadow: assistantType === 'student' ? '0 0 70px rgba(16,185,129,0.7)' :
                        assistantType === 'lawyer' ? '0 0 70px rgba(245,158,11,0.7)' :
                          '0 0 70px rgba(59,130,246,0.7)'
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className={`relative h-14 w-14 md:h-16 md:w-16 xl:h-24 xl:w-24 rounded-xl md:rounded-2xl xl:rounded-3xl flex items-center justify-center overflow-hidden border ${assistantType === 'student' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-[0_0_50px_rgba(16,185,129,0.5)] border-emerald-400/40' :
                      assistantType === 'lawyer' ? 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-[0_0_50px_rgba(245,158,11,0.5)] border-amber-400/40' :
                        'bg-gradient-to-br from-blue-500 to-blue-600 shadow-[0_0_50px_rgba(59,130,246,0.5)] border-blue-400/40'
                      }`}
                    style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
                  >
                    {/* Active Interior Scanning Bar */}
                    <motion.div
                      animate={{ y: ['-140%', '140%'] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-x-0 h-[3px] bg-white/30 blur-[1px] shadow-[0_0_15px_white] z-20"
                    />

                    <motion.div
                      animate={{
                        filter: ['drop-shadow(0 0 8px rgba(255,255,255,0.4))', 'drop-shadow(0 0 20px rgba(255,255,255,0.9))', 'drop-shadow(0 0 8px rgba(255,255,255,0.4))']
                      }}
                      style={{ transform: 'translateZ(20px)' }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Cpu size={isMobile ? 24 : 32} className="text-white xl:!w-12 xl:!h-12" />
                    </motion.div>

                    {/* Scanning light streak */}
                    <motion.div
                      animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-24"
                    />
                  </motion.div>
                </div>

                <div className="flex flex-col items-center gap-1 mb-2">

                  {isAuthenticated && user?.subscriptionStatus === 'free' && (
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.3, duration: 0.5 }}
                      onClick={() => router.push('/pricing')}
                      className="cursor-pointer mb-2 md:mb-2 inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-blue-500/5 border border-blue-500/20 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all shadow-sm group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-blue-400/90 tracking-wide uppercase">
                          {(user.tokenBalance ?? 0) === 0 ? 'ZERO' : (user.tokenBalance ?? 0)} {t('tokens_unit') || 'Tokens'}
                        </span>
                        <span className="opacity-30 text-white text-[10px]">|</span>
                        <span className="text-[13px] font-medium text-[var(--muted)] group-hover:text-blue-400 transition-colors">
                          {(user.tokenBalance ?? 0) <= 0 ? `${t('quota_refresh_msg')} ${getRefreshTimeLabel()}` : (t('sidebar_upgrade') || 'Upgrade')}
                        </span>
                      </div>
                      <ArrowRight size={14} className="text-blue-500 group-hover:translate-x-1 transition-transform" />
                    </motion.div>
                  )}

                  <div className="flex flex-col items-center text-center">
                    <motion.span
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.4, duration: 0.5 }}
                      className="text-2xl md:text-3xl xl:text-5xl font-bold tracking-tighter text-[var(--text)] mb-1"
                    >
                      {t('chat_greeting').replace('{name}', user?.fullName || (user?.email ? user.email.split('@')[0] : 'there'))}
                    </motion.span>
                    <motion.h1
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5, duration: 0.5 }}
                      className="text-lg md:text-xl xl:text-2xl xl:mt-1 font-medium tracking-tight text-[var(--muted)]"
                    >
                      {t('chat_begin') || "How can I help you today?"}
                    </motion.h1>
                  </div>
                </div>

                {/* Suggestion Chips — Premium Grid */}
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
                  className="grid grid-cols-2 lg:grid lg:grid-cols-3 xl:grid-cols-3 gap-2 md:gap-2 xl:gap-5 mt-4 md:mt-0 md:mb-2 xl:mt-8"
                >
                  {(assistantType === 'student' ? [
                    { emoji: "🏛️", label: "University Registration", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "🪪", label: "ID / İkamet", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "📜", label: "Denklik (Equivalency)", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "🛏️", label: "Dormitory & Housing", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "✈️", label: "Student Visa", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "🚌", label: "IstanbulKart", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' }
                  ] : assistantType === 'lawyer' ? [
                    { emoji: "🏗️", label: "Company Formation", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "📑", label: "Contract Review", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🤝", label: "Employment Law", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "⚖️", label: "Legal Disputes", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🏠", label: "Residency & Visas", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🏢", label: "Real Estate Law", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' }
                  ] : [
                    { emoji: "☕", label: "Cafe & Restaurant", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🛍️", label: "Retail Shop", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "💻", label: "Office & Tech", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🏥", label: "Pharmacy", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🩺", label: "Clinic", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🏠", label: "Residence Permit", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' }
                  ]).map((chip, i) => (
                    <div
                      key={i}
                      onClick={() => startService(chip.label)}
                      className={`lg:glass-mesh lg:${chip.mesh} text-[var(--text)] text-[11px] md:text-[13px] xl:text-[15px] py-1.5 md:py-2 xl:py-4 px-2.5 md:px-3 xl:px-5 rounded-[16px] md:rounded-[16px] xl:rounded-[20px] flex items-center gap-2 md:gap-2 xl:gap-3 font-bold select-none md:backdrop-blur-xl transition-all hover:scale-[1.02] md:hover:scale-105 active:scale-95 cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] lg:bg-[var(--surface)] lg:opacity-95 lg:shadow-[0_8px_30px_rgba(0,0,0,0.12)] group w-full h-[48px] md:h-[48px] xl:h-[72px] ${chip.border}`}
                    >
                      <div className={`w-7 h-7 md:w-8 md:h-8 xl:w-11 xl:h-11 rounded-[10px] xl:rounded-[14px] bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0 group-hover:bg-[var(--surface)] transition-colors ${chip.color.replace('text', 'bg')}/10`}>
                        <span className="text-sm md:text-base xl:text-xl filter drop-shadow-sm">{chip.emoji}</span>
                      </div>
                      <span className="flex-1 min-w-0 leading-tight text-left line-clamp-2">{t(CHIP_I18N_KEY[chip.label] ?? chip.label) || chip.label}</span>
                    </div>
                  ))}
                </motion.div>

                {/* Spacer to absorb vertical height and avoid mt-auto scroll bugs */}
                <div className="flex-1 min-h-[16px]" />

                {/* Chat Input Pill (empty state) */}
                <div className="w-full max-w-3xl xl:max-w-4xl mx-auto mb-2 md:mb-4 xl:mb-8 px-4 shrink-0">
                  {/* Mode toggle */}
                  <div className="flex justify-center mb-2.5">
                    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] shadow-sm">
                      <button
                        onClick={() => setShowTextInput(false)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold tracking-tight transition-all duration-200 select-none ${
                          !showTextInput
                            ? 'bg-[var(--text)] text-[var(--bg)] shadow-sm'
                            : 'text-[var(--muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        <Sparkles size={11} />
                        {t('chat_tab_suggested')}
                      </button>
                      <button
                        onClick={() => setShowTextInput(true)}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold tracking-tight transition-all duration-200 select-none ${
                          showTextInput
                            ? 'bg-[var(--text)] text-[var(--bg)] shadow-sm'
                            : 'text-[var(--muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        {t('chat_tab_chat')}
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {showTextInput && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scaleY: 0.96 }}
                        animate={{ opacity: 1, y: 0, scaleY: 1 }}
                        exit={{ opacity: 0, y: 8, scaleY: 0.96 }}
                        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                        style={{ originY: 'bottom' }}
                      >
                  <div className="relative flex items-center gap-2 rounded-full p-1.5 border border-[var(--border)] bg-[var(--surface-1)] shadow-sm focus-within:shadow-md transition-all">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        if (e.target.files?.[0]) setFile(e.target.files[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="hidden sm:flex p-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
                    >
                      <Plus size={22} />
                    </button>

                    {showTextInput ? (
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => {
                          setInput(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }
                        }}
                        placeholder={t(`chat_placeholder_${assistantType}`) || "Message TurkGateWay..."}
                        className="flex-1 bg-transparent py-3 px-3 text-[16px] text-[var(--text)] focus:outline-none resize-none overflow-y-auto min-h-[44px] max-h-[120px] slim-scroll placeholder:text-gray-400"
                        rows={1}
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => setShowTextInput(true)}
                        className="flex-1 flex items-center gap-2.5 py-3 px-3 text-[14px] text-[var(--muted)]/40 hover:text-[var(--muted)]/80 transition-colors group"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 group-hover:opacity-100 transition-opacity shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        <span>{t(`chat_placeholder_${assistantType}`) || "Or type your message..."}</span>
                      </button>
                    )}

                    <div className="flex items-center gap-1.5 pr-1">
                      {input.trim() && !busy ? (
                        <button
                          onClick={() => send()}
                          className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] hover:opacity-90 transition-all shrink-0"
                        >
                          <Send size={18} />
                        </button>
                      ) : busy ? (
                        <button
                          onClick={cancelResponse}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-all shrink-0 font-bold text-[13px] active:scale-95"
                        >
                          <X size={14} />
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={toggleVoice}
                          className={`relative flex items-center gap-2 px-4 py-2 rounded-full transition-all shrink-0 ${isListening
                            ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                            : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]'
                            }`}
                        >
                          {isListening && (
                            <motion.div
                              initial={{ scale: 0.8, opacity: 0.5 }}
                              animate={{ scale: 1.5, opacity: 0 }}
                              transition={{ repeat: Infinity, duration: 1.5 }}
                              className="absolute inset-0 bg-red-500 rounded-full z-0"
                            />
                          )}
                          <div className="relative z-10 flex items-center gap-2">
                            {isListening ? (
                              <div className="flex items-center gap-1">
                                {[1, 2, 3].map(i => (
                                  <motion.div
                                    key={i}
                                    animate={{ height: [8, 16, 8] }}
                                    transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                                    className="w-1 bg-white rounded-full"
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-0.5">
                                <div className="w-0.5 h-3 bg-current rounded-full animate-pulse" />
                                <div className="w-0.5 h-2 bg-current rounded-full" />
                                <div className="w-0.5 h-3.5 bg-current rounded-full animate-pulse" />
                              </div>
                            )}
                            <Mic size={18} className={isListening ? 'animate-pulse' : ''} />
                            <span className="hidden sm:inline text-[13px] font-bold tracking-tight">
                              {isListening ? (t('chat_listening') || "Listening...") : (t('chat_voice') || "Voice")}
                            </span>
                          </div>
                        </button>
                      )}
                    </div>

                    {file && (
                      <div className="absolute -top-12 left-4">
                        <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] shadow-sm">
                          <FileText size={12} className="text-indigo-400" />
                          <span className="truncate max-w-[120px]">{file.name}</span>
                          <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                            <Plus size={12} className="rotate-45" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
              </div> {/* Close my-auto wrapper */}
            </div>
          ) : (
            <div className={`flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 md:px-8 py-10 space-y-12 pb-44 slim-scroll bg-[var(--bg)]/40 rounded-t-[40px]`} dir={isRTL ? 'rtl' : 'ltr'}>
              <AnimatePresence initial={false}>
                {msgs.map(m => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                    className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'assistant' && (
                      <div className={`group relative h-9 w-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 mt-1 shadow-md border ${assistantType === 'student' ? 'from-emerald-500 to-emerald-600 shadow-emerald-500/30 border-emerald-400/30' :
                        assistantType === 'lawyer' ? 'from-amber-500 to-amber-600 shadow-amber-500/30 border-amber-400/30' :
                          'from-blue-500 to-blue-600 shadow-blue-500/30 border-blue-400/30'
                        } ${isRTL ? 'ml-4' : 'mr-4'} transition-all cursor-pointer`}
                        onClick={() => speak(translateHistory(m.content))}
                      >
                        <Cpu size={18} className="group-hover:opacity-0 transition-opacity" />
                        <Volume2 size={16} className="absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}

                    <div className={`flex flex-col max-w-[92%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`text-[17px] leading-[1.75] whitespace-pre-wrap ${m.role === 'user'
                        ? 'px-5 py-3 rounded-2xl border border-[var(--border)] text-[var(--text)] bg-[var(--surface-1)] shadow-sm'
                        : `text-[var(--text)] px-6 py-4 rounded-3xl bg-[var(--surface-2)]/30 border border-[var(--border)] w-full font-normal`
                        }`}
                      >
                        {(() => {
                          const contentToRender = translateHistory(m.content);

                          if (m.role === 'assistant') {
                            // Support for custom [CTA: Label | URL] buttons
                            const parts = contentToRender.split(/(\[CTA: .+? \| .+?\])/g);

                            return (
                              <div className={`prose dark:prose-invert max-w-none ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
                                {parts.map((part, idx) => {
                                  const ctaMatch = part.match(/\[CTA: (.+?) \| (.+?)\]/);
                                  if (ctaMatch) {
                                    const [, label, url] = ctaMatch;
                                    return (
                                      <motion.div
                                        key={idx}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="my-6"
                                      >
                                        <Link
                                          href={url}
                                          target="_blank"
                                          className="inline-flex items-center gap-2 bg-[var(--surface-2)] hover:bg-[#3c4043] text-[var(--text)] px-8 py-3 rounded-full font-bold transition-all shadow-lg active:scale-95 border border-[var(--border)] group no-underline"
                                        >
                                          <span>{label}</span>
                                          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                        </Link>
                                      </motion.div>
                                    );
                                  }

                                  const isLastAssistantMsg = m.id === msgs[msgs.length - 1]?.id && m.role === 'assistant';
                                  // Default to full length for historical messages (anything not in current typing state)
                                  const charsToShow = visibleChars[m.id] ?? (m.role === 'assistant' ? part.length : part.length);
                                  const textToDisplay = part.slice(0, charsToShow);

                                  return (
                                    <div key={idx} className="relative inline-block w-full">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                          p: ({ node, ...props }) => <p className="mb-4 last:mb-0" {...props} />,
                                          ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-4 space-y-1.5 marker:text-[var(--accent)]" {...props} />,
                                          ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 marker:text-[var(--accent)]" {...props} />,
                                          strong: ({ node, ...props }) => <strong className="font-bold text-[var(--text)]" {...props} />,
                                          a: ({ node, ...props }) => <a className="text-[var(--accent)] hover:underline transition-colors font-medium" {...props} />,
                                          code: ({ node, className, children, ...props }) => {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const isInline = !match && !className?.includes('language-');
                                            return isInline
                                              ? <code className="bg-[var(--surface-2)] text-[var(--accent)] px-1.5 py-0.5 rounded text-[14px] font-mono font-medium" {...props}>{children}</code>
                                              : <div className="bg-[#0e0e0e] rounded-xl border border-white/10 overflow-hidden my-6"><div className="px-4 py-2 bg-white/5 text-[11px] text-white/40 font-mono uppercase tracking-widest border-b border-white/10">{match?.[1] || 'code'}</div><pre className="p-4 overflow-x-auto text-[14px] text-gray-300 font-mono leading-relaxed"><code {...props}>{children}</code></pre></div>
                                          }
                                        }}
                                      >
                                        {textToDisplay}
                                      </ReactMarkdown>

                                      {/* ChatGPT Typing Cursor */}
                                      {isLastAssistantMsg && charsToShow < part.length && (
                                        <motion.span
                                          animate={{ opacity: [1, 0, 1] }}
                                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                                          className="inline-block w-2.5 h-5 ml-1 bg-[var(--text)] align-middle shadow-[0_0_8px_var(--text)] opacity-80"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                          return contentToRender;
                        })()}
                      </div>

                      {/* New / Renewal choice buttons — show after the bot asks */}
                      {pendingServiceChoice && SERVICE_FLOW_RESPONSES[pendingServiceChoice] && m.id === msgs[msgs.length - 1]?.id && m.role === 'assistant' && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4, duration: 0.4 }}
                          className="flex flex-wrap justify-center gap-2 mt-4 w-full"
                        >
                          {(() => {
                            const btnLabels = getLocalizedBtnLabels(pendingServiceChoice!, language);
                            return [
                              { label: btnLabels.primary, type: 'new' as const },
                              { label: btnLabels.secondary, type: 'renewal' as const },
                            ].map((option) => (
                            <button
                              key={option.type}
                              onClick={() => {
                                const service = pendingServiceChoice!;
                                const flow = SERVICE_FLOW_RESPONSES[service];
                                if (!flow) return;
                                const choiceLabel = option.label.replace(/^[^\w]*/, '').trim();
                                const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: choiceLabel };
                                
                                if (option.type === 'new') {
                                  const serviceChips = SERVICE_AREA_CHIPS[service];
                                  const askAreaText = language === 'tr'
                                    ? (serviceChips?.question
                                        ? `📍 ${serviceChips.question} Lütfen aşağıdan birini seçin veya yazın.`
                                        : "İstanbul'da hangi bölgede veya ilçede başvuruyorsunuz? Lütfen aşağıdan birini seçin veya yazın.")
                                    : language === 'ar'
                                    ? (serviceChips?.question
                                        ? `📍 ${serviceChips.question} يرجى الاختيار أدناه أو الكتابة.`
                                        : "في أي منطقة أو بلدية في إسطنبول تقوم بالتقديم؟ يرجى اختيار إحدى المناطق أدناه أو كتابة المنطقة.")
                                    : (serviceChips?.question
                                        ? `📍 ${serviceChips.question}\n\nSelect one below or type your answer:`
                                        : "Which area or district in Istanbul are you applying in? Please select one below or type your district.");

                                  const responseId = msgIdRef.current++;
                                  setVisibleChars(prev => ({ ...prev, [responseId]: 0 }));
                                  setMsgs(p => [...p, userMsg, { id: responseId, role: 'assistant', content: askAreaText }]);
                                  setPendingServiceChoice(null);
                                  setAwaitingAreaService(service);

                                  // Animate typewriter
                                  let chars = 0;
                                  const interval = setInterval(() => {
                                    chars += 15;
                                    setVisibleChars(prev => ({ ...prev, [responseId]: chars }));
                                    if (chars >= askAreaText.length) clearInterval(interval);
                                  }, 30);

                                  saveMessagesToHistory([
                                    { role: 'user', content: choiceLabel },
                                    { role: 'assistant', content: askAreaText }
                                  ], service, option.type);
                                } else {
                                  const responseId = msgIdRef.current++;
                                  const responseText = flow.renewal;
                                  setVisibleChars(prev => ({ ...prev, [responseId]: 0 }));
                                  setMsgs(p => [...p, userMsg, { id: responseId, role: 'assistant', content: responseText }]);
                                  setPendingServiceChoice(null);

                                  // Animate typewriter
                                  let chars = 0;
                                  const interval = setInterval(() => {
                                    chars += 15;
                                    setVisibleChars(prev => ({ ...prev, [responseId]: chars }));
                                    if (chars >= responseText.length) clearInterval(interval);
                                  }, 30);

                                  saveMessagesToHistory([
                                    { role: 'user', content: choiceLabel },
                                    { role: 'assistant', content: responseText }
                                  ], service, option.type);

                                  handleRenewalSubmit(service);
                                }

                                // Update session title to reflect choice
                                const newTitle = `${service} — ${choiceLabel}`;
                                setSessionTitle(newTitle);
                              }}
                              className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-[13px] border transition-all active:scale-95 hover:scale-[1.03] cursor-pointer ${
                                option.type === 'new'
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-400'
                                  : 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:border-blue-400'
                              }`}
                            >
                              {option.label}
                            </button>
                            ));
                          })()}
                        </motion.div>
                      )}

                      {/* Area selection chips — show when awaitingAreaService is active */}
                      {awaitingAreaService && m.id === msgs[msgs.length - 1]?.id && m.role === 'assistant' && (() => {
                        const chipConfig = SERVICE_AREA_CHIPS[awaitingAreaService];
                        const chipsToShow = chipConfig?.chips ?? DEFAULT_AREA_CHIPS;
                        const chipEmoji = chipConfig?.emoji ?? '📍';
                        return (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4, duration: 0.4 }}
                            className="flex flex-wrap justify-center gap-2 mt-4 w-full"
                          >
                            {chipsToShow.map((chipLabel) => (
                              <button
                                key={chipLabel}
                                onClick={() => handleAreaSubmit(chipLabel)}
                                className="flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-[12px] border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:border-blue-400 transition-all active:scale-95 cursor-pointer"
                              >
                                {chipEmoji} {chipLabel}
                              </button>
                            ))}
                          </motion.div>
                        );
                      })()}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* ── Service shortcuts (Suggested mode only) ───────────────────────
                  Only services + their flow — no tangential follow-up questions.
                  Hidden while typing (Chat mode) or mid New/Renewal/district flow. */}
              {/* ── Dashboard-active: replace chips with new-chat button ──────── */}
              {hasDashboard && !busy && !pendingServiceChoice && !awaitingAreaService && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full mt-5 mb-1"
                >
                  <button
                    onClick={() => handleNewChat()}
                    className={`w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl border font-semibold text-[13px] transition-all active:scale-95 hover:scale-[1.01] ${
                      assistantType === 'student'
                        ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400 hover:bg-emerald-500/[0.12]'
                        : assistantType === 'lawyer'
                        ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-400 hover:bg-amber-500/[0.12]'
                        : 'border-blue-500/30 bg-blue-500/[0.06] text-blue-400 hover:bg-blue-500/[0.12]'
                    }`}
                  >
                    <Plus size={15} />
                    Start new chat for new service
                  </button>
                </motion.div>
              )}

              {!hasDashboard && !showTextInput && !busy && msgs.length > 0 && msgs[msgs.length - 1]?.role === 'assistant' && !pendingServiceChoice && !awaitingAreaService && (() => {
                const services = SERVICE_OPTIONS[assistantType] ?? [];
                if (services.length === 0) return null;

                const iconBg = assistantType === 'student'
                  ? 'bg-emerald-500/10 group-hover:bg-emerald-500/20'
                  : assistantType === 'lawyer'
                  ? 'bg-amber-500/10 group-hover:bg-amber-500/20'
                  : 'bg-blue-500/10 group-hover:bg-blue-500/20';

                const cardBg = assistantType === 'student'
                  ? 'bg-emerald-500/[0.04] border-emerald-500/20 hover:bg-emerald-500/[0.09] hover:border-emerald-500/40 hover:shadow-emerald-500/5'
                  : assistantType === 'lawyer'
                  ? 'bg-amber-500/[0.04] border-amber-500/20 hover:bg-amber-500/[0.09] hover:border-amber-500/40 hover:shadow-amber-500/5'
                  : 'bg-blue-500/[0.04] border-blue-500/20 hover:bg-blue-500/[0.09] hover:border-blue-500/40 hover:shadow-blue-500/5';

                const labelColor = assistantType === 'student' ? 'text-emerald-300/90'
                  : assistantType === 'lawyer' ? 'text-amber-300/90'
                  : 'text-blue-300/90';

                return (
                  <div className="w-full mt-5 mb-1">
                    {/* Section label */}
                    <div className="flex items-center gap-3 mb-3 px-1">
                      <div className="h-px flex-1 bg-[var(--border)] opacity-30" />
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)] opacity-35 select-none">
                        {language === 'ar' ? 'اختر خدمة' : language === 'tr' ? 'Hizmet seçin' : 'Choose a service'}
                      </span>
                      <div className="h-px flex-1 bg-[var(--border)] opacity-30" />
                    </div>
                    {/* Services grid */}
                    <motion.div
                      key={`svc-${msgs[msgs.length - 1]?.id}-${assistantType}`}
                      initial="hidden"
                      animate="visible"
                      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } } }}
                      className="grid grid-cols-2 gap-2"
                    >
                      {services.map((svc) => (
                        <motion.button
                          key={svc.label}
                          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.2,0.8,0.2,1] } } }}
                          onClick={() => startService(svc.label)}
                          className={`group flex items-center gap-3 px-3.5 py-3.5 rounded-2xl border transition-all duration-200 active:scale-95 hover:scale-[1.02] cursor-pointer text-left shadow-sm hover:shadow-md ${cardBg}`}
                        >
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-base transition-colors duration-200 ${iconBg}`}>
                            {svc.emoji}
                          </div>
                          <span className={`flex-1 text-[12.5px] font-semibold leading-snug ${labelColor}`}>
                            {t(CHIP_I18N_KEY[svc.label] ?? svc.label) || svc.label}
                          </span>
                          <ArrowRight size={12} className="text-[var(--muted)] opacity-20 shrink-0 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all duration-200" />
                        </motion.button>
                      ))}
                    </motion.div>
                  </div>
                );
              })()}

              {busy && (
                <motion.div
                  initial={{ opacity: 0, x: isRTL ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex w-full items-center justify-start py-4"
                >
                  <div className={`relative h-10 w-10 flex items-center justify-center shrink-0 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                    {/* Glowing status ring */}
                    <div className={`absolute inset-0 rounded-xl border backdrop-blur-sm ${assistantType === 'student' ? 'border-emerald-500/20 bg-emerald-500/5' :
                      assistantType === 'lawyer' ? 'border-amber-500/20 bg-amber-500/5' :
                        'border-blue-500/20 bg-blue-500/5'
                      }`} />
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className={`absolute inset-[-2px] rounded-xl border-t ${assistantType === 'student' ? 'border-emerald-500/60' :
                        assistantType === 'lawyer' ? 'border-amber-500/60' :
                          'border-blue-500/60'
                        }`}
                    />
                    <Cpu size={18} className={`${assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                        'text-blue-500'
                      } animate-pulse relative z-10`} />

                    {/* Live processing blip */}
                    <motion.div
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className={`absolute -top-0.5 ${isRTL ? '-left-0.5' : '-right-0.5'} w-1.5 h-1.5 rounded-full z-20 ${assistantType === 'student' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,1)]' :
                        assistantType === 'lawyer' ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,1)]' :
                          'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,1)]'
                        }`}
                    />
                  </div>
                  <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'}`}>
                    <span className={`text-[14px] font-medium animate-pulse ${assistantType === 'student' ? 'text-emerald-500/80' :
                      assistantType === 'lawyer' ? 'text-amber-500/80' :
                        'text-blue-500/80'
                      }`}>
                      {t('agent_thinking')}
                    </span>
                  </div>
                  {isSpeaking && (
                    <button
                      onClick={() => window.speechSynthesis.cancel()}
                      className="ml-4 p-1.5 rounded-full bg-[var(--surface-2)] text-red-500 hover:text-white hover:bg-red-500 transition-all shadow-sm active:scale-95"
                      title="Stop Speaking"
                    >
                      <VolumeX size={18} />
                    </button>
                  )}
                </motion.div>
              )}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}

          {/* New-chat countdown banner — shown when user tries to message a completed session */}
          <AnimatePresence>
            {newChatCountdown !== null && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[70] px-4 w-full max-w-sm"
              >
                <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl backdrop-blur-md ${
                  assistantType === 'student'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : assistantType === 'lawyer'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                }`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-black text-[13px] ${
                    assistantType === 'student' ? 'bg-emerald-500/20' : assistantType === 'lawyer' ? 'bg-amber-500/20' : 'bg-blue-500/20'
                  }`}>
                    {newChatCountdown}
                  </div>
                  <span className="text-[13px] font-medium">
                    Opening a new chat with same agent in {newChatCountdown}s...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Claude-style Quota Notification Overlay */}
          <AnimatePresence>
            {showQuotaWarning && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[440px] z-[60] px-4"
              >
                <div className="bg-white border border-gray-200 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] p-6 relative">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <Cpu size={20} className="text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[15px] font-bold text-gray-900 mb-1">
                        {t('quota_reached_title')}
                      </h4>
                      <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
                        {t('quota_reached_desc')}
                      </p>

                      <div className="flex items-center gap-2 mb-6">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        <span className="text-[12px] font-medium text-indigo-600">
                          {t('quota_refresh_msg')} {getRefreshTimeLabel()}
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                          onClick={() => setShowQuotaWarning(false)}
                          className="px-4 py-2 text-[13px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {t('quota_dismiss')}
                        </button>
                        <Link
                          href="/pricing"
                          onClick={() => setShowQuotaWarning(false)}
                          className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold transition-all no-underline flex items-center gap-2 active:scale-95"
                        >
                          <span>{t('pricing_upgrade')}</span>
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sticky Input Bar - Floating Gemini Pill */}
          {!isEmpty && (
            <div className="absolute bottom-0 left-0 w-full pt-16 pb-8 px-4 flex justify-center bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/90 to-transparent z-40">
              <div className="w-full max-w-3xl relative">
                {/* Mode toggle */}
                <div className="flex justify-center mb-2.5">
                  <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-[var(--surface-2)] border border-[var(--border)] shadow-sm">
                    <button
                      onClick={() => setShowTextInput(false)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold tracking-tight transition-all duration-200 select-none ${
                        !showTextInput
                          ? 'bg-[var(--text)] text-[var(--bg)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      <Sparkles size={11} />
                      {t('chat_tab_suggested')}
                    </button>
                    <button
                      onClick={() => setShowTextInput(true)}
                      className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-bold tracking-tight transition-all duration-200 select-none ${
                        showTextInput
                          ? 'bg-[var(--text)] text-[var(--bg)] shadow-sm'
                          : 'text-[var(--muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      {t('chat_tab_chat')}
                    </button>
                  </div>
                </div>
                <AnimatePresence>
                  {showTextInput && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scaleY: 0.96 }}
                      animate={{ opacity: 1, y: 0, scaleY: 1 }}
                      exit={{ opacity: 0, y: 8, scaleY: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                      style={{ originY: 'bottom' }}
                    >
                <div className={`relative flex items-center gap-2 rounded-full p-1.5 border border-[var(--border)] transition-all duration-300 bg-[var(--surface-1)] shadow-sm ${busy ? 'opacity-70' : 'focus-within:shadow-md'}`}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="hidden sm:flex p-2 text-[var(--muted)] hover:text-[var(--accent)] transition-all shrink-0"
                  >
                    <Plus size={22} />
                  </button>
                  {showTextInput ? (
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => {
                        setInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }
                      }}
                      disabled={busy}
                      placeholder={t(`chat_placeholder_${assistantType}`) || "Ask anything..."}
                      className="flex-1 bg-transparent py-2.5 px-1 text-[16px] leading-normal text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:outline-none resize-none overflow-y-auto min-h-[44px] max-h-[120px] slim-scroll"
                      rows={1}
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setShowTextInput(true)}
                      className="flex-1 flex items-center gap-2 py-2.5 px-3 text-[13px] text-[var(--muted)]/40 hover:text-[var(--muted)]/80 transition-colors group"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 group-hover:opacity-100 transition-opacity shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      <span>Type a message...</span>
                    </button>
                  )}
                  <div className="flex items-center gap-1.5 pr-1">
                    {input.trim() && !busy ? (
                      <button
                        onClick={() => { send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }}
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] shadow-sm hover:opacity-90 transition-all shrink-0"
                      >
                        <Send size={18} />
                      </button>
                    ) : busy ? (
                      <button
                        onClick={cancelResponse}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white transition-all shrink-0 font-bold text-[13px] active:scale-95"
                      >
                        <X size={14} />
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={toggleVoice}
                        className={`relative flex items-center gap-2 px-4 py-2 rounded-full transition-all shrink-0 ${isListening
                          ? 'bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)]'
                          : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]'
                          }`}
                      >
                        {isListening && (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0.5 }}
                            animate={{ scale: 1.5, opacity: 0 }}
                            transition={{ repeat: Infinity, duration: 1.5 }}
                            className="absolute inset-0 bg-red-500 rounded-full z-0"
                          />
                        )}
                        <div className="relative z-10 flex items-center gap-2">
                          {isListening ? (
                            <div className="flex items-center gap-1">
                              {[1, 2, 3].map(i => (
                                <motion.div
                                  key={i}
                                  animate={{ height: [8, 16, 8] }}
                                  transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.1 }}
                                  className="w-1 bg-white rounded-full"
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <div className="w-0.5 h-3 bg-current rounded-full animate-pulse" />
                              <div className="w-0.5 h-2 bg-current rounded-full" />
                              <div className="w-0.5 h-3.5 bg-current rounded-full animate-pulse" />
                            </div>
                          )}
                          <Mic size={18} className={isListening ? 'animate-pulse' : ''} />
                          <span className="hidden sm:inline text-[13px] font-bold tracking-tight">
                            {isListening ? (t('chat_listening') || "Listening...") : (t('chat_voice') || "Voice")}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  {file && (
                    <div className="absolute -top-12 left-4">
                      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] shadow-sm">
                        <FileText size={12} className="text-indigo-400" />
                        <span className="truncate max-w-[120px]">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                          <Plus size={12} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

        </div>

        {/* ── ChatGPT-Style Voice Call Overlay ── */}
        <AnimatePresence>
          {isVoiceMode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.35 }}
              className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
              style={{ background: 'radial-gradient(ellipse at 50% 60%, #0a0a14 0%, #05050a 100%)' }}
            >
              {/* ── Ambient background glow ── */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div
                  animate={{ scale: isSpeaking ? [1, 1.3, 1] : [1, 1.08, 1], opacity: isSpeaking ? [0.25, 0.55, 0.25] : [0.12, 0.22, 0.12] }}
                  transition={{ duration: isSpeaking ? 1.2 : 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
                  style={{
                    background: assistantType === 'student'
                      ? 'radial-gradient(circle, rgba(16,185,129,0.4) 0%, transparent 70%)'
                      : assistantType === 'lawyer'
                        ? 'radial-gradient(circle, rgba(245,158,11,0.4) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(96,165,250,0.45) 0%, transparent 70%)'
                  }}
                />
              </div>

              {/* ── Top bar: chip + hang up ── */}
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 pt-8 z-10">
                <div /> {/* Left flex spacer to keep chip centered and X on the right if needed, or chip left */}

                {/* Detected service chip */}
                <AnimatePresence>
                  {detectedService && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      className={`flex items-center gap-2.5 px-4 py-2 rounded-full border backdrop-blur-xl shadow-lg transition-all ${detectedService === 'student'
                        ? 'border-emerald-500/20 bg-emerald-500/10 shadow-emerald-500/10'
                        : detectedService === 'lawyer'
                          ? 'border-amber-500/20 bg-amber-500/10 shadow-amber-500/10'
                          : 'border-blue-500/20 bg-blue-500/10 shadow-blue-500/10'
                        }`}
                    >
                      {/* Cpu icon with animated glow — identical to navbar chip */}
                      <div className="relative flex items-center justify-center">
                        <Cpu
                          size={15}
                          className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${detectedService === 'student' ? 'text-emerald-400'
                            : detectedService === 'lawyer' ? 'text-amber-400'
                              : 'text-blue-400'
                            }`}
                        />
                        <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${detectedService === 'student' ? 'bg-emerald-500/30'
                          : detectedService === 'lawyer' ? 'bg-amber-500/30'
                            : 'bg-blue-500/30'
                          }`} />
                      </div>
                      <span className={`text-[12px] font-black uppercase tracking-[0.15em] ${detectedService === 'student' ? 'text-emerald-400'
                        : detectedService === 'lawyer' ? 'text-amber-400'
                          : 'text-blue-400'
                        }`}>
                        {detectedService === 'permit' ? 'Business Agent' : detectedService === 'student' ? 'Student Agent' : 'Legal Agent'}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Close / hang up */}
                <button
                  onClick={hangUpCall}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-white/8 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-white/60 hover:text-red-400 transition-all active:scale-90"
                >
                  <X size={20} />
                </button>
              </div>

              {/* ── ChatGPT-Exact Voice Orb ── */}
              <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>

                {/* The perfect circle container — clips everything inside */}
                <motion.div
                  animate={{ scale: isSpeaking ? [1, 1.04, 0.98, 1.03, 1] : isListening ? [1, 1.02, 0.99, 1.02, 1] : 1 }}
                  transition={{ duration: isSpeaking ? 1.0 : 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="relative overflow-hidden"
                  style={{
                    width: 220, height: 220,
                    borderRadius: '50%',
                    background: assistantType === 'student'
                      ? 'linear-gradient(160deg, #a7f3d0 0%, #34d399 40%, #059669 100%)'
                      : assistantType === 'lawyer'
                        ? 'linear-gradient(160deg, #fef3c7 0%, #fcd34d 40%, #d97706 100%)'
                        : 'linear-gradient(160deg, #e0f2fe 0%, #7dd3fc 40%, #3b82f6 100%)',
                    boxShadow: isSpeaking
                      ? assistantType === 'student'
                        ? '0 0 80px 30px rgba(52,211,153,0.45), 0 0 140px 60px rgba(16,185,129,0.2)'
                        : assistantType === 'lawyer'
                          ? '0 0 80px 30px rgba(252,211,77,0.45), 0 0 140px 60px rgba(245,158,11,0.2)'
                          : '0 0 80px 30px rgba(125,211,252,0.45), 0 0 140px 60px rgba(59,130,246,0.2)'
                      : assistantType === 'student'
                        ? '0 0 40px 10px rgba(52,211,153,0.2)'
                        : assistantType === 'lawyer'
                          ? '0 0 40px 10px rgba(252,211,77,0.2)'
                          : '0 0 40px 10px rgba(125,211,252,0.2)'
                  }}
                >
                  {/* Cloud blob 1 — large bright wisp, top-left */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['-10%', '15%', '-5%', '10%', '-10%'] : ['-10%', '8%', '-6%', '5%', '-10%'],
                      y: isSpeaking ? ['-15%', '10%', '-8%', '12%', '-15%'] : ['-15%', '5%', '-10%', '3%', '-15%'],
                    }}
                    transition={{ duration: isSpeaking ? 2.8 : 8, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute"
                    style={{
                      width: '130%', height: '130%',
                      top: '-15%', left: '-15%',
                      borderRadius: '50%',
                      background: 'radial-gradient(ellipse at 45% 42%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.4) 35%, transparent 65%)',
                      filter: 'blur(18px)',
                    }}
                  />
                  {/* Cloud blob 2 — medium, drifts bottom-right */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['20%', '-10%', '18%', '-5%', '20%'] : ['20%', '-5%', '12%', '-8%', '20%'],
                      y: isSpeaking ? ['20%', '-5%', '22%', '-2%', '20%'] : ['20%', '5%', '15%', '0%', '20%'],
                    }}
                    transition={{ duration: isSpeaking ? 3.2 : 10, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
                    className="absolute"
                    style={{
                      width: '110%', height: '110%',
                      top: '-5%', left: '-5%',
                      borderRadius: '50%',
                      background: assistantType === 'student'
                        ? 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(167,243,208,0.5) 30%, transparent 60%)'
                        : assistantType === 'lawyer'
                          ? 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(254,243,199,0.5) 30%, transparent 60%)'
                          : 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(186,230,255,0.5) 30%, transparent 60%)',
                      filter: 'blur(22px)',
                    }}
                  />
                  {/* Cloud blob 3 — small bright accent, wanders freely */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['-5%', '25%', '-8%', '20%', '-5%'] : ['5%', '-12%', '15%', '-5%', '5%'],
                      y: isSpeaking ? ['10%', '-12%', '18%', '-8%', '10%'] : ['-5%', '10%', '-8%', '6%', '-5%'],
                    }}
                    transition={{ duration: isSpeaking ? 2.0 : 12, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
                    className="absolute"
                    style={{
                      width: '80%', height: '80%',
                      top: '10%', left: '10%',
                      borderRadius: '60% 40% 50% 50% / 40% 50% 50% 60%',
                      background: 'radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.85) 0%, transparent 55%)',
                      filter: 'blur(14px)',
                    }}
                  />
                  {/* Cloud blob 4 — subtle deep color layer for depth */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['15%', '-15%', '10%', '-10%', '15%'] : ['0%', '10%', '-5%', '8%', '0%'],
                      y: isSpeaking ? ['-10%', '15%', '-5%', '10%', '-10%'] : ['0%', '-8%', '5%', '-3%', '0%'],
                      scale: isSpeaking ? [1, 1.15, 0.9, 1.1, 1] : 1,
                    }}
                    transition={{ duration: isSpeaking ? 1.8 : 9, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
                    className="absolute inset-0"
                    style={{
                      borderRadius: '50%',
                      background: assistantType === 'student'
                        ? 'radial-gradient(ellipse at 70% 30%, rgba(16,185,129,0.45) 0%, transparent 60%)'
                        : assistantType === 'lawyer'
                          ? 'radial-gradient(ellipse at 70% 30%, rgba(245,158,11,0.45) 0%, transparent 60%)'
                          : 'radial-gradient(ellipse at 70% 30%, rgba(59,130,246,0.5) 0%, transparent 60%)',
                      filter: 'blur(20px)',
                    }}
                  />
                </motion.div>

                {/* Soft outer glow ring — pulses on speak */}
                <motion.div
                  animate={{ opacity: isSpeaking ? [0.4, 0.8, 0.4] : isListening ? [0.2, 0.4, 0.2] : [0.1, 0.2, 0.1], scale: isSpeaking ? [1, 1.12, 1] : [1, 1.04, 1] }}
                  transition={{ duration: isSpeaking ? 1.0 : 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    width: 240, height: 240,
                    background: assistantType === 'student'
                      ? 'radial-gradient(circle, rgba(52,211,153,0.35) 0%, transparent 70%)'
                      : assistantType === 'lawyer'
                        ? 'radial-gradient(circle, rgba(252,211,77,0.35) 0%, transparent 70%)'
                        : 'radial-gradient(circle, rgba(125,211,252,0.4) 0%, transparent 70%)',
                    filter: 'blur(20px)',
                  }}
                />

                {/* Busy processing dots overlay */}
                {busy && !isSpeaking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex items-center justify-center z-[100]"
                  >
                    <div className="flex gap-2.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ y: [0, -15, 0], scale: [1, 1.25, 1] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                          className="w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.6)]"
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* ── Status text + transcript ── */}
              <div className="mt-20 text-center max-w-lg px-6 z-10">
                <AnimatePresence mode="wait">
                  {callEnded ? (
                    <motion.div key="ended" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
                      <p className="text-white/90 text-xl font-bold">Call Summary Saved</p>
                      <p className="text-white/40 text-sm">Your dashboard has been updated with the conversation roadmap.</p>
                    </motion.div>
                  ) : (
                    <motion.div key="active" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                      <p className="text-white/35 text-[11px] font-black uppercase tracking-[0.35em] mb-3">
                        {isSpeaking ? 'Assistant Speaking…' : isListening ? 'Listening…' : 'Connecting…'}
                      </p>
                      <motion.div
                        key={voiceTranscript}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-white/80 text-lg font-semibold leading-relaxed min-h-[32px]"
                      >
                        {isListening ? (
                          voiceTranscript ? voiceTranscript : (
                            <div className="flex items-center justify-center h-[32px] gap-2 mt-2">
                              {[0, 1, 2].map(i => (
                                <motion.div
                                  key={i}
                                  animate={{ y: [0, -6, 0], scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
                                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                                  className={`w-2.5 h-2.5 rounded-full ${assistantType === 'student' ? 'bg-emerald-400/80' : assistantType === 'lawyer' ? 'bg-amber-400/80' : 'bg-blue-400/80'}`}
                                />
                              ))}
                            </div>
                          )
                        ) : isSpeaking ? (
                          fullCleanText.split(' ').slice(0, 12).map((w, i) => (
                            <motion.span key={i} animate={{ opacity: i < spokenWordIndex ? 1 : 0.2 }} transition={{ duration: 0.08 }} className="inline-block mr-1">{w}</motion.span>
                          ))
                        ) : null}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Hang-up button ── */}
              {!callEnded && (
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  onClick={hangUpCall}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.93 }}
                  className="absolute bottom-12 w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.5)] transition-colors z-10"
                >
                  {/* Phone hang-up icon */}
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                  </svg>
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>


        <style dangerouslySetInnerHTML={{
          __html: `
          .slim-scroll::-webkit-scrollbar { width: 6px; }
          .slim-scroll::-webkit-scrollbar-track { background: transparent; }
          .slim-scroll::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; }
          .slim-scroll::-webkit-scrollbar-thumb:hover { background: var(--border); }
        `}} />
      </main>
    </div>
  );
}
