#!/usr/bin/env python3
"""
Analyzer: Generate ai_analysis for alerts by finding similar past alerts.
Unix-philosophy: Single responsibility—just analysis.
"""

import json
import numpy as np
from typing import Dict, List, Tuple, Optional
from datetime import datetime
import sqlite3
from vectorizer import AlertVectorizer

try:
    from scipy.spatial.distance import cosine
    from sklearn.ensemble import IsolationForest
except ImportError:
    print("ERROR: scipy or scikit-learn not installed. Run: pip install scipy scikit-learn")
    exit(1)

class AlertAnalyzer:
    def __init__(self, config_path: str = "./brain/config.json"):
        """Initialize analyzer with config and vectorizer."""
        with open(config_path, 'r') as f:
            self.config = json.load(f)
        self.vectorizer = AlertVectorizer(config_path)
        self.db_path = self.config.get("vector_db_path", "./brain/vectors.db")
        self._init_db()
    
    def _init_db(self):
        """Initialize SQLite database for storing vectors."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vectors (
                record_id TEXT PRIMARY KEY,
                ticker TEXT,
                vector BLOB,
                direction TEXT,
                price REAL,
                intent TEXT,
                recorded_at TEXT,
                price_change_5d REAL,
                was_correct INTEGER,
                price_timeline TEXT
            )
        """)
        # Ensure legacy DBs get the new column
        cursor.execute("PRAGMA table_info(vectors)")
        cols = [r[1] for r in cursor.fetchall()]
        if 'price_timeline' not in cols:
            try:
                cursor.execute("ALTER TABLE vectors ADD COLUMN price_timeline TEXT")
            except Exception:
                pass
        conn.commit()
        conn.close()
    
    def store_vector(self, alert: Dict, vector: np.ndarray):
        """Store alert vector in the database."""
        record_id = self.vectorizer.get_alert_id(alert)
        direction = alert.get("direction", "UNKNOWN")
        price = float(alert.get("price", 0))
        intent = alert.get("intent", "")
        recorded_at = alert.get("recordedAt", datetime.now().isoformat())
        
        # Determine if direction was correct (using 5-day outcome)
        price_change_5d = None
        was_correct = None
        if "highest5DayPercent" in alert:
            try:
                price_change_5d = float(alert["highest5DayPercent"])
                if direction == "LONG":
                    was_correct = 1 if price_change_5d > 0 else 0
                elif direction == "SHORT":
                    was_correct = 1 if price_change_5d < 0 else 0
            except:
                pass
        
        vector_bytes = vector.tobytes()
        # include full price timeline for short-term analysis
        price_timeline = {
            "1m": alert.get("percentAfter1m"),
            "5m": alert.get("percentAfter5m"),
            "30m": alert.get("percentAfter30m"),
            "1h": alert.get("percentAfter1h"),
            "6h": alert.get("percentAfter6h"),
            "1d": alert.get("percentAfter1d"),
            "3d": alert.get("percentAfter3d")
        }
        price_timeline_json = json.dumps(price_timeline)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO vectors 
            (record_id, ticker, vector, direction, price, intent, recorded_at, price_change_5d, was_correct, price_timeline)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (record_id, alert.get("ticker", "UNKNOWN"), vector_bytes, direction, price, intent, recorded_at, price_change_5d, was_correct, price_timeline_json))
        conn.commit()
        conn.close()
    
    def load_vector(self, record_id: str) -> Optional[np.ndarray]:
        """Load a stored vector."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT vector FROM vectors WHERE record_id = ?", (record_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return np.frombuffer(row[0], dtype=np.float32)
        return None
    
    def find_similar_alerts(self, query_vector: np.ndarray, top_n: int = None) -> List[Dict]:
        """Find similar past alerts using cosine similarity."""
        if top_n is None:
            top_n = self.config.get("top_n_matches", 10)
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT record_id, ticker, vector, direction, price_change_5d, was_correct FROM vectors")
        rows = cursor.fetchall()
        conn.close()
        
        # Build feature weights vector (structured features first, then embedding)
        embedding_dim = getattr(self.vectorizer, 'embedding_dim', self.config.get('embedding_dimension', 768))
        fw = self.config.get('feature_weights', {})
        structured_weights = np.array([
            fw.get('soRatio', 0.15),
            fw.get('float', 0.10),
            fw.get('volume', 0.08),
            fw.get('marketCap', 0.08),
            fw.get('ftdPercent', 0.07),
            fw.get('filingTimeBonus', 0.05),
            fw.get('soBonus', 0.05),
            fw.get('isShort', 0.05),
            fw.get('custodianVerified', 0.05)
        ], dtype=np.float32)
        signal_emb_weight = fw.get('signal_embedding', 0.42)
        weights = np.concatenate([structured_weights, np.full(embedding_dim, signal_emb_weight, dtype=np.float32)])

        similarities = []
        for row in rows:
            record_id, ticker, vector_bytes, direction, price_change_5d, was_correct = row
            stored_vector = np.frombuffer(vector_bytes, dtype=np.float32)
            # Weighted cosine similarity
            try:
                weighted_q = query_vector * weights
                weighted_s = stored_vector * weights
                similarity = 1 - cosine(weighted_q, weighted_s)
            except Exception:
                similarity = 0.0
            similarities.append({
                "record_id": record_id,
                "ticker": ticker,
                "similarity": similarity,
                "direction": direction,
                "price_change_5d": price_change_5d,
                "was_correct": was_correct
            })
        
        # Sort by similarity descending
        similarities.sort(key=lambda x: x["similarity"], reverse=True)
        return similarities[:top_n]
    
    def compute_win_rate(self, similar_alerts: List[Dict], direction: str) -> float:
        """Compute win rate from similar past alerts."""
        if not similar_alerts or all(s["was_correct"] is None for s in similar_alerts):
            return 0.5  # Default neutral if no outcome data
        
        correct_count = sum(1 for s in similar_alerts if s["was_correct"] == 1)
        total_count = sum(1 for s in similar_alerts if s["was_correct"] is not None)
        
        return correct_count / total_count if total_count > 0 else 0.5
    
    def compute_avg_move(self, similar_alerts: List[Dict]) -> float:
        """Compute average price move from similar past alerts."""
        moves = [s["price_change_5d"] for s in similar_alerts if s["price_change_5d"] is not None]
        return np.mean(moves) if moves else 0.0
    
    def detect_outliers(self, similar_alerts: List[Dict], all_alerts: List[Dict]) -> List[str]:
        """Detect outliers using Isolation Forest on the similar alerts."""
        if len(similar_alerts) < 2:
            return []
        
        # Extract features from similar alerts
        data = []
        tickers = []
        for alert in similar_alerts:
            vector = self.load_vector(alert["record_id"])
            if vector is not None:
                # Use first 9 features (structured features only)
                data.append(vector[:9])
                tickers.append(alert["ticker"])
        
        if len(data) < 2:
            return []
        
        X = np.array(data)
        clf = IsolationForest(contamination=self.config.get("outlier_contamination", 0.1), random_state=42)
        outlier_labels = clf.fit_predict(X)
        
        outliers = [tickers[i] for i, label in enumerate(outlier_labels) if label == -1]
        return outliers
    
    def compute_confidence(self, win_rate: float, similarity_score: float, is_outlier: bool, intent: str) -> float:
        """Compute confidence using the formula: win_rate * (1 - outlier_penalty) * similarity_score.
        outlier penalty can be dynamic based on intent/signal category."""
        penalties = self.config.get('outlier_penalties', {})
        default_pen = self.config.get('outlier_penalty_default', 0.1)
        outlier_penalty = penalties.get(intent, default_pen) if is_outlier else 0
        confidence = win_rate * (1 - outlier_penalty) * similarity_score
        return float(np.clip(confidence, 0.0, 1.0))  # Clamp to [0, 1]
    
    def generate_ai_analysis(self, alert: Dict) -> Dict:
        """Generate ai_analysis for a given alert."""
        # Vectorize the alert
        vector = self.vectorizer.vectorize_alert(alert)
        
        # Find similar past alerts
        similar_alerts = self.find_similar_alerts(vector)

        # Minimum historical data guard
        min_hist = self.config.get('min_historical_data_for_analysis', 5)
        if len(similar_alerts) < min_hist:
            return {
                "win_rate": None,
                "avg_move": None,
                "confidence": None,
                "matches": [],
                "outliers": [],
                "verdict": f"INSUFFICIENT DATA (<{min_hist} MATCHES)",
                "last_trained": datetime.now().isoformat()
            }
        
        if not similar_alerts:
            # No historical data yet
            return {
                "win_rate": None,
                "avg_move": None,
                "confidence": None,
                "matches": [],
                "outliers": [],
                "verdict": "INSUFFICIENT HISTORICAL DATA",
                "last_trained": datetime.now().isoformat()
            }
        
        # Compute metrics
        win_rate = self.compute_win_rate(similar_alerts, alert.get("direction", "UNKNOWN"))
        avg_move = self.compute_avg_move(similar_alerts)
        avg_similarity = float(np.mean([s["similarity"] for s in similar_alerts]))
        outliers = self.detect_outliers(similar_alerts, [alert])
        is_outlier = alert.get("ticker", "") in outliers
        intent = alert.get('intent', '')
        confidence = self.compute_confidence(win_rate, avg_similarity, is_outlier, intent)

        matches = [s["ticker"] for s in similar_alerts if s["similarity"] > self.config.get("similarity_threshold", 0.7)]

        # Signal cluster stats (group by stored 'intent' or fallback to direction)
        signal_clusters = {}
        for s in similar_alerts:
            key = s.get('direction') or 'UNKNOWN'
            if key not in signal_clusters:
                signal_clusters[key] = { 'count': 0, 'wins': 0, 'avg_move': 0.0 }
            signal_clusters[key]['count'] += 1
            signal_clusters[key]['wins'] += 1 if s.get('was_correct') == 1 else 0
            if s.get('price_change_5d') is not None:
                signal_clusters[key]['avg_move'] += float(s.get('price_change_5d'))

        for k in list(signal_clusters.keys()):
            c = signal_clusters[k]
            if c['count'] > 0:
                c['win_rate'] = round(c['wins'] / c['count'], 2)
                c['avg_move'] = round(c['avg_move'] / c['count'], 2)
            else:
                c['win_rate'] = None
                c['avg_move'] = None

        top_cluster = None
        if signal_clusters:
            top_cluster = max(signal_clusters.items(), key=lambda x: x[1].get('win_rate', 0))[0]

        verdict = f"{alert.get('direction', 'UNKNOWN')} (confidence: {confidence:.2f}, win_rate: {win_rate*100:.0f}%)"
        
        return {
            "win_rate": round(win_rate, 2),
            "avg_move": round(avg_move, 2),
            "confidence": round(confidence, 2),
            "matches": matches,
            "outliers": outliers,
            "signal_clusters": signal_clusters,
            "top_cluster": top_cluster,
            "verdict": verdict,
            "last_trained": datetime.now().isoformat()
        }
    
    def update_stocks_json(self, stocks_path: str = "./logs/stocks.json"):
        """Update stocks.json with ai_analysis for alerts that have outcomes."""
        with open(stocks_path, 'r') as f:
            alerts = json.load(f)
        
        updated_count = 0
        for alert in alerts:
            if "ai_analysis" not in alert:
                ai_analysis = self.generate_ai_analysis(alert)
                alert["ai_analysis"] = ai_analysis
                updated_count += 1
        
        with open(stocks_path, 'w') as f:
            json.dump(alerts, f, indent=2)

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        ticker = sys.argv[1]
        analyzer = AlertAnalyzer()
        analyzer.update_stocks_json()
