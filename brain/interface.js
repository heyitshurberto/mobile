/**
 * AI Pipeline Interface
 * Spawn vectorizer, analyzer, trainer from Node.js
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

class AIPipeline {
  constructor(brainPath = './brain') {
    this.brainPath = brainPath;
    this.configPath = path.join(brainPath, 'config.json');
  }

  /**
   * Generate ai_analysis for alerts with outcomes
   */
  async analyze(stocksPath = './logs/stocks.json') {
    return new Promise((resolve, reject) => {
      const py = spawn('python3', [
        path.join(this.brainPath, 'analyzer.py'),
        stocksPath
      ]);

      let stdout = '';
      let stderr = '';

      py.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      py.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      py.on('close', (code) => {
        if (code === 0) {
          resolve({ status: 'ok', stocksPath });
        } else {
          reject(new Error(stderr || 'Analysis failed'));
        }
      });

      py.on('error', reject);
    });
  }

  /**
   * Retrain on all alert data
   */
  async retrain(stocksPath = './logs/stocks.json') {
    return new Promise((resolve, reject) => {
      const py = spawn('python3', [
        path.join(this.brainPath, 'trainer.py'),
        stocksPath
      ]);

      let stderr = '';

      py.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      py.on('close', (code) => {
        if (code === 0) {
          resolve({ status: 'ok', stocksPath });
        } else {
          reject(new Error(stderr || 'Retraining failed'));
        }
      });

      py.on('error', reject);
    });
  }

  /**
   * Prepare alert with empty ai_analysis
   */
  prepareAlert(alert) {
    if (!alert.ai_analysis) {
      alert.ai_analysis = {
        win_rate: null,
        avg_move: null,
        confidence: null,
        matches: [],
        outliers: [],
        verdict: 'PENDING',
        last_trained: null
      };
    }
    return alert;
  }

  /**
   * Check if alert should be analyzed (after expiry)
   */
  shouldAnalyze(alert) {
    const now = new Date();
    const expiresAt = new Date(alert.expiresAt);
    return now >= expiresAt && alert.highest5DayPercent !== undefined;
  }
}

export default AIPipeline;
