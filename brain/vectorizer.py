#!/usr/bin/env python3
"""
Vectorizer: Convert alert signals + metadata into hybrid vectors for similarity search.
Unix-philosophy: Single responsibility—just vectorization.
"""

import json
import hashlib
from typing import Dict, List, Tuple

import numpy as np
from sentence_transformers import SentenceTransformer

class AlertVectorizer:
    def __init__(self, config_path: str = "./brain/config.json"):
        """Initialize vectorizer with config."""
        with open(config_path, 'r') as f:
            self.config = json.load(f)
        
        # Load embedding model (lazy load)
        self.model = None
        self.embedding_dim = self.config.get("embedding_dimension", 768)
    
    def _load_model(self):
        """Lazy-load embedding model."""
        if self.model is not None:
            return

        model_name = self.config.get("embedding_model", "nomic-embed-text-1.5-v2")
        try:
            self.model = SentenceTransformer(model_name)
        except Exception:
            # If model download/load fails, leave model as None and fall back later
            self.model = None
    
    def extract_structured_features(self, alert: Dict) -> np.ndarray:
        """Extract numeric features from alert."""
        # Normalize numeric fields
        so_ratio = float(alert.get("soRatio", "0").strip("%")) / 100.0  # 0-1 scale
        float_shares = float(alert.get("float", 0))
        volume = float(alert.get("volume", 0))
        market_cap = float(alert.get("marketCap", 1))  # Avoid div by 0
        ftd_percent = float(alert.get("ftdPercent", "0").strip("%")) / 100.0
        filing_time_bonus = float(alert.get("filingTimeBonus", 1.0))
        so_bonus = float(alert.get("soBonus", 1.0))
        is_short = 1.0 if alert.get("isShort") else 0.0
        custodian_verified = 1.0 if alert.get("custodianVerified") else 0.0
        
        # Log-normalize large numbers
        float_norm = np.log1p(float_shares) / 20.0  # Cap at log(1e9) ~= 20
        volume_norm = np.log1p(volume) / 15.0
        market_cap_norm = np.log1p(market_cap) / 25.0
        
        features = np.array([
            so_ratio,
            float_norm,
            volume_norm,
            market_cap_norm,
            ftd_percent,
            filing_time_bonus,
            so_bonus,
            is_short,
            custodian_verified
        ], dtype=np.float32)
        
        return features
    
    def embed_signals(self, alert: Dict) -> np.ndarray:
        """Convert intent + signals into text embedding."""
        self._load_model()
        
        # Combine intent and signals into a single text
        intent_text = alert.get("intent", "")
        signals = alert.get("signals", {})
        
        signal_descriptions = []
        for signal_type, evidence_list in signals.items():
            evidence_text = ", ".join(evidence_list) if isinstance(evidence_list, list) else str(evidence_list)
            signal_descriptions.append(f"{signal_type}: {evidence_text}")
        
        full_text = f"{intent_text}. " + ". ".join(signal_descriptions)
        full_text = full_text[:512]  # Truncate to reasonable length
        
        # Embed the text using sentence-transformers if available, otherwise use a deterministic fallback
        if self.model is not None:
            try:
                embedding = self.model.encode(full_text, convert_to_numpy=True)
                return embedding.astype(np.float32)
            except Exception:
                pass

        # Fallback: deterministic pseudo-embedding using a hash-derived RNG seed
        h = hashlib.sha256(full_text.encode('utf-8')).hexdigest()
        seed = int(h[:16], 16) % (2**32)
        rng = np.random.RandomState(seed)
        emb = rng.normal(size=(self.embedding_dim,)).astype(np.float32)
        # normalize
        norm = np.linalg.norm(emb)
        if norm > 0:
            emb /= norm
        return emb
    
    def vectorize_alert(self, alert: Dict) -> np.ndarray:
        """Create hybrid vector: structured features + signal embedding."""
        structured = self.extract_structured_features(alert)
        signal_embed = self.embed_signals(alert)
        
        # Combine: structured (9 dims) + signal embedding (768 dims) = 777 dims
        hybrid_vector = np.concatenate([structured, signal_embed])
        return hybrid_vector.astype(np.float32)
    
    def get_alert_id(self, alert: Dict) -> str:
        """Generate unique ID for an alert (for tracking)."""
        return alert.get("recordId", alert.get("ticker", "unknown"))


if __name__ == "__main__":
    # Test vectorizer
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            test_alert = json.load(f)
        vec = AlertVectorizer()
        v = vec.vectorize_alert(test_alert)
        print(f"Vector shape: {v.shape}")
        print(f"Vector (first 20): {v[:20]}")
