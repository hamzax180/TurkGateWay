"""
Knowledge Base SQLAlchemy Models
---------------------------------
PostgreSQL + pgvector tables for the RAG knowledge system.
"""

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from datetime import datetime
from database import Base


class KnowledgeArticle(Base):
    """
    Structured knowledge entries — one per topic per agent.
    Each article represents a complete answer about a specific topic.
    """
    __tablename__ = "knowledge_articles"

    id = Column(Integer, primary_key=True, index=True)
    agent_type = Column(String(20), nullable=False, index=True)  # "permit" | "student" | "lawyer"
    category = Column(String(100), nullable=False, index=True)   # "restaurant", "tax_id", etc.
    subcategory = Column(String(100), nullable=True)             # optional finer grouping
    title = Column(String(300), nullable=False)
    content = Column(Text, nullable=False)                       # full article text
    tags = Column(JSONB, default=[])                             # searchable tags
    metadata_ = Column("metadata", JSONB, default={})            # timeline, costs, etc.
    language = Column(String(5), default="en")                   # "en", "tr", "ar"
    embedding = Column(Vector(768), nullable=True)               # text-embedding-004
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chunks = relationship("KnowledgeChunk", back_populates="article", cascade="all, delete-orphan")

    # Create an index for vector similarity search
    __table_args__ = (
        Index('ix_knowledge_articles_embedding', embedding, postgresql_using='ivfflat',
              postgresql_with={'lists': 100},
              postgresql_ops={'embedding': 'vector_cosine_ops'}),
    )


class KnowledgeChunk(Base):
    """
    Smaller retrieval units — each article is split into ~200-400 token chunks.
    The RAG system searches chunks for the most relevant context.
    """
    __tablename__ = "knowledge_chunks"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("knowledge_articles.id"), nullable=False)
    chunk_text = Column(Text, nullable=False)
    chunk_index = Column(Integer, default=0)
    embedding = Column(Vector(768), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    article = relationship("KnowledgeArticle", back_populates="chunks")

    __table_args__ = (
        Index('ix_knowledge_chunks_embedding', embedding, postgresql_using='ivfflat',
              postgresql_with={'lists': 100},
              postgresql_ops={'embedding': 'vector_cosine_ops'}),
    )


class AgentContext(Base):
    """
    Per-agent structured reference data — districts, NACE codes, etc.
    Not for RAG retrieval, but for enriching generated responses.
    """
    __tablename__ = "agent_context"

    id = Column(Integer, primary_key=True, index=True)
    agent_type = Column(String(20), nullable=False, index=True)
    context_key = Column(String(100), nullable=False)
    data = Column(JSONB, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
