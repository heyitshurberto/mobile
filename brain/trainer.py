#!/usr/bin/env python3
"""
Trainer: Recursively retrain the model on all alert data.
Unix-philosophy: Single responsibility—just training.
"""

import json
import numpy as np
from datetime import datetime
from typing import List, Dict
from analyzer import AlertAnalyzer
from vectorizer import AlertVectorizer

class AlertTrainer:
    def __init__(self, config_path: str = "./brain/config.json"):
        """Initialize trainer."""
        with open(config_path, 'r') as f:
            self.config = json.load(f)
        self.analyzer = AlertAnalyzer(config_path)
        self.vectorizer = AlertVectorizer(config_path)
    
    def train_on_new_alert(self, alert: Dict):
        """Store a new alert's vector for future similarity searches."""
        vector = self.vectorizer.vectorize_alert(alert)
        self.analyzer.store_vector(alert, vector)
    
    def full_retrain(self, stocks_path: str = "./logs/stocks.json"):
        """Full retraining: process all alerts and rebuild the vector database."""
        with open(stocks_path, 'r') as f:
            alerts = json.load(f)
        
        for alert in alerts:
            self.train_on_new_alert(alert)
        
        self.analyzer.update_stocks_json(stocks_path)
        self.config["last_retrained"] = datetime.now().isoformat()
        with open(self.config.get("config_path", "./config.json"), 'w') as f:
            json.dump(self.config, f, indent=2)
    
    def incremental_train(self, new_alerts: List[Dict]):
        """Incremental training: add new alerts without reprocessing old ones."""
        for alert in new_alerts:
            self.train_on_new_alert(alert)


if __name__ == "__main__":
    import sys
    trainer = AlertTrainer()
    if len(sys.argv) > 1 and sys.argv[1] == "full":
        trainer.full_retrain()
    else:
        print("Usage: python trainer.py [full] (or run from Node.js via child_process)")
