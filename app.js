import fs from 'fs';
import fetch from 'node-fetch';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcrypt';

// Load environment variables from .env file
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const eqIndex = trimmedLine.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmedLine.substring(0, eqIndex).trim();
        const value = trimmedLine.substring(eqIndex + 1).trim();
        if (key && value) {
          process.env[key] = value;
        }
      }
    }
  });
}

const CONFIG = {
  // Alert filtering criteria
  FILE_TIME: 1,                     // Minutes retro to fetch filings
  MIN_ALERT_VOLUME: 1000,           // Capture initial filing
  STRONG_SIGNAL_MIN_VOLUME: 500,    // Very early for strong catalysts
  MAX_FLOAT_6K: 50000000,           // Max float size for 6-K (50M limit)
  MAX_FLOAT_8K: 75000000,           // Max float size for 8-K (75M limit)
  MAX_FAV_RATIO: 90,                // Max F/AV ratio for alerts (filtering out mega floats)
  PERSONAL_ALERT_MAX_FLOAT: 25000000, // Max float for personal alerts (25M)
  ALLOWED_COUNTRIES: ['israel', 'texas', 'china', 'hong kong', 'cayman islands', 'virgin islands', 'canada', 'delaware'], // Allowed incorporation/located countries
  CTB_WATCHLIST: ['NMHI', 'SEV', 'BINI', 'AGILQ', 'MOTS', 'PLYX', 'ABPO', 'NEPTF', 'SHPWQ', 'FBGL', 'SEELQ', 'TMDE', 'ANNA', 'ACCL', 'IOTR', 'GXAI', 'SMCZ', 'FABTQ', 'NCI', 'CZOOF', 'MLEC', 'SMX', 'IONM', 'IBG', 'CRE'], // High CTB stocks (CTB > 250%, Availability tracked) - updated from IBorrowDesk Mar 18 2026
  // Enable optimizations for Raspberry Pi devices
  PI_MODE: true,              // Enable Pi optimizations          
  REFRESH_PEAK: 1,            // 10s during trading hours (7am-10am ET)
  REFRESH_NORMAL: 30000,      // 30s during trading hours (3:30am-6pm ET)
  REFRESH_NIGHT: 300000,      // 5m outside trading hours (conserve power)
  REFRESH_WEEKEND: 600000,    // 10m on weekends (very low activity)
  YAHOO_TIMEOUT: 10000,       // Reduced from 10s for Pi performance
  SEC_RATE_LIMIT: 5000,       // Minimum 5ms between SEC requests
  SEC_FETCH_TIMEOUT: 10000,   // Increased to 10s for large SEC filings (was 5s causing timeouts)
  MAX_COMBINED_SIZE: 100000,  // Reduced from 150k for Pi RAM
  MAX_RETRY_ATTEMPTS: 7,      // Reduced from 7 for Pi resources
  // Log files
  ALERTS_FILE: 'logs/alert.json',      // File to store recent alerts
  STOCKS_FILE: 'logs/stocks.json',     // File to store all alerts
  PERFORMANCE_FILE: 'logs/quote.json', // File to store performance data
  CSV_FILE: 'logs/track.csv',          // File to store CSV export of all alerts
  // GitHub & Webhook settings
  GITHUB_REPO_PATH: process.env.GITHUB_REPO_PATH || process.cwd(), // Local path to GitHub repo (default: current working directory)
  GITHUB_USERNAME: process.env.GITHUB_USERNAME || 'your-github-username', // GitHub username
  GITHUB_REPO_NAME: process.env.GITHUB_REPO_NAME || 'your-repo-name', // GitHub repo name
  GITHUB_DOMAIN: process.env.GITHUB_DOMAIN || 'your-domain.com', // GitHub Pages domain
  GITHUB_PUSH_ENABLED: process.env.GITHUB_PUSH_ENABLED !== 'false' && process.env.GITHUB_PUSH_ENABLED !== '0', // Enable/disable GitHub push (default: true, set to false in .env to disable)
  PERSONAL_WEBHOOK_URL: process.env.PERSONAL_WEBHOOK || 'https://discord.com/api/webhooks/1468261977435672669/a5j3OSGh2EveSxQSvIjQ3JGWVEFR6qCW_TmZ_tImeZmdt8PvfuL10EaeMk03MvLZC9e9', // Personal Discord webhook URL (detailed format, no branding)
  PERSONAL_WEBHOOK_ENABLED: process.env.PERSONAL_WEBHOOK_ENABLED !== 'false' && process.env.PERSONAL_WEBHOOK_ENABLED !== '0', // Enable/disable personal webhook (default: true)
  PAID_WEBHOOK_URL: process.env.PAID_WEBHOOK || 'https://discord.com/api/webhooks/1468245633709375619/I4wrp79Faxb9vY135jC-PNs82M7CEMjHSUkk8g8P9zOKQex9P9c8FZHAtKAAXTf1WFPc', // Paid Discord webhook URL (Telegram style)
  PAID_WEBHOOK_ENABLED: process.env.PAID_WEBHOOK_ENABLED !== 'false' && process.env.PAID_WEBHOOK_ENABLED !== '0', // Enable/disable paid webhook (default: true)
  ALERTS_DISTRIBUTION_ENABLED: process.env.ALERTS_DISTRIBUTION_ENABLED !== 'false' && process.env.ALERTS_DISTRIBUTION_ENABLED !== '0', // Master toggle for all alert distribution (webhooks + GitHub push) (default: true)
  DISCORD_ENABLED: process.env.DISCORD_ENABLED === 'true', // Enable/disable Discord alerts (set to 'true' in .env to enable)
  // Telegram settings
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '', // Telegram bot token
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '', // Telegram chat ID for alerts
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED === 'true', // Enable/disable Telegram alerts (set to 'true' in .env to enable)
  // Domain settings
  GITHUB_PAGES_ENABLED: process.env.GITHUB_PAGES_ENABLED !== 'false' && process.env.GITHUB_PAGES_ENABLED !== '0', // Enable/disable GitHub Pages domain push (default: true)
  GITHUB_QUOTE_PUSH_ENABLED: process.env.GITHUB_QUOTE_PUSH_ENABLED !== 'false' && process.env.GITHUB_QUOTE_PUSH_ENABLED !== '0', // Enable/disable auto-push of quotes to GitHub (default: true)
  // 2FA settings
  TWO_FACTOR_ENABLED: true, // Set to false to disable 2FA approval gate (keep basic auth always on)
  // Email authentication settings
  EMAIL_AUTH_ENABLED: true, // Use email-based auth instead of basic auth
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: process.env.SMTP_PORT || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'noreply@eugenes.shop'
};

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalWrite = process.stdout.write;
const suppressPatterns = [
  'Fetching crumb', 'We expected', "We'll try", 'Success. Cookie', 'New crumb',
  'guce.yahoo.com', 'consent.yahoo.com', 'query1.finance.yahoo.com', 'collectConsent', 'copyConsent',
  'redirect to guce', 'getcrumb', '/quote/AAPL',
  'yahoo-finance2', 'v2 is no longer maintained nor supported', 'Please migrate to v3',
  'Circuit open', 'returning cached quote', 'Opening circuit', 'attempt', 'Unexpected token',
  'Using cached quote', 'Quote fetch failed', 'Failed to fetch quote'
];
const isSuppressed = (msg) => {
  if (!msg) return false;
  const str = msg.toString ? msg.toString() : String(msg);
  if (str.startsWith('fetch ')) return true;
  return suppressPatterns.some(pattern => str.includes(pattern));
};
console.log = (...args) => {
  const msg = args[0]?.toString() || '';
  if (!isSuppressed(msg)) originalLog(...args);
};
console.warn = (...args) => {
  const msg = args[0]?.toString() || '';
  if (!isSuppressed(msg)) originalWarn(...args);
};
console.error = (...args) => {
  const msg = args[0]?.toString() || '';
  if (!isSuppressed(msg)) originalError(...args);
};
process.stdout.write = function(str) {
  if (!isSuppressed(str)) return originalWrite.call(process.stdout, str);
  return true;
};

const require = createRequire(import.meta.url);
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

process.env.DEBUG = '';

const rateLimit = {
  lastRequest: 0,
  minInterval: CONFIG.SEC_RATE_LIMIT,
  async wait() {
    const now = Date.now();
    const waitTime = this.minInterval - (now - this.lastRequest);
    if (waitTime > 0) await wait(waitTime);
    this.lastRequest = Date.now();
  }
};

// Parse applicant/registrant name from SEC filing text - BULLETPROOF VERSION
// SEC filings ALWAYS have company name in standardized headers
const parseApplicantName = (text) => {
  if (!text) return 'N/A';
  
  // Pattern 1: "APPLICANT:" or "Applicant:" with full company info (most common)
  let match = text.match(/^[^a-z]*?APPLICANT\s*[:\-]?\s*\n?\s*([A-Z][A-Za-z0-9\s&,.\-()/'\']+?)(?:\n|$)/im);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2) return name;
  }
  
  // Pattern 2: "REGISTRANT:" field (8-K/6-K standard header)
  match = text.match(/^[^a-z]*?REGISTRANT\s*[:\-]?\s*\n?\s*([A-Z][A-Za-z0-9\s&,.\-()/'\']+?)(?:\n|$)/im);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2) return name;
  }
  
  // Pattern 3: "Name of Registrant" standard SEC label
  match = text.match(/Name of Registrant\s*[:\-]?\s*\n?\s*([A-Z][A-Za-z0-9\s&,.\-()/'\']+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2) return name;
  }
  
  // Pattern 4: Header with company name + CIK (most reliable format)
  match = text.match(/([A-Z][A-Za-z0-9\s&,.\-()/'\']*(?:INC|LLC|LTD|CORP|CORPORATION|CO|COMPANY|GROUP|HOLDINGS|PLC|AG|SE|GmbH|Ltd|Inc|LLC)\.?)\s*\n\s*\(?[0-9]{10}\)?/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2) return name;
  }
  
  // Pattern 5: "Form 8-K" / "Form 6-K" cover page with company name on first real line
  match = text.match(/(?:FORM\s*(?:8-?K|6-?K|10-?K|10-?Q).*?\n){1,3}\s*([A-Z][A-Za-z0-9\s&,.\-()/'\']+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    // Exclude boilerplate
    if (!/^(SEC|EDGAR|ITEM|EXHIBIT|SCHEDULE|TABLE OF CONTENTS)$/i.test(name) && name.length > 2) {
      return name.substring(0, 150);
    }
  }
  
  // Pattern 6: Company name before CIK number (very common)
  match = text.match(/^([A-Z][A-Za-z0-9\s&,.\-()/'\']*?)\s{2,}\d{10}/im);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2 && !/^(SEC|EDGAR|FORM|ITEM)$/i.test(name)) return name;
  }
  
  // Pattern 7: After "UNITED STATES OF AMERICA" SEC header
  match = text.match(/UNITED STATES OF AMERICA[^\n]*\n\s*([A-Z][A-Za-z0-9\s&,.\-()/'\']+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2) return name;
  }
  
  // Pattern 8: "SEC File No" followed by company name
  match = text.match(/(?:SEC File No|File Number)[^\n]*\n\s*([A-Z][A-Za-z0-9\s&,.\-()/'\']+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 2) return name;
  }
  
  // Pattern 9: First substantive capitalized line (fallback)
  match = text.match(/^[^a-z\n]{0,50}([A-Z][A-Za-z0-9\s&,.\-()/'\']{10,}?)(?:\n|$)/m);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ').substring(0, 150);
    if (name.length > 3 && !/^(EXHIBIT|TABLE|SCHEDULE|FORM|ITEM|PART)$/i.test(name)) {
      return name;
    }
  }
  
  return 'N/A';
};

// Extract the actual person/entity filing the document (not company name)
// Look for "Applicant" or explicit filer signatures
const parseFilerName = (text) => {
  if (!text) return null;
  
  // Helper to validate if text looks like a real person/officer name
  const isValidName = (str) => {
    if (!str || str.length < 2 || str.length > 150) return false;
    
    // Reject explicit non-names and placeholders
    if (/^(N\/A|NA|UNKNOWN|Unknown|None|NONE|Yes|No|True|False|Not\s+Applicable|Not\s+applicable)$/i.test(str)) return false;
    
    // Reject if it's obviously boilerplate/instructions
    if (/Translation of registrant|as specified in|charter|agreement|contract|Please see|Exhibit|Form \d|SEC|EDGAR|Item \d|Schedule|pursuant to|hereby/i.test(str)) return false;
    
    // Reject URLs, emails, pure special chars
    if (/www\.|http|@|\.com|^[\d\s,.\-()'"\/&;:]+$/.test(str)) return false;
    
    // Reject pure numbers
    if (/^\d+$/.test(str)) return false;
    
    // Reject if mostly numbers (>40% numeric)
    const numCount = (str.match(/\d/g) || []).length;
    if (numCount > str.length * 0.4) return false;
    
    // Reject street addresses (numbered streets, compass directions in addresses)
    if (/^\d+\s+(?:Front|Queen|Main|Broadway|Street|St\.|Avenue|Ave\.|Road|Rd\.|Suite|Apt\.|Floor|Circle|Drive|Lane|Place|Boulevard|Blvd|North|South|East|West|N\.|S\.|E\.|W\.)/i.test(str)) return false;
    if (/Street|Avenue|Suite|Floor|Building|P\.O\.|Box\s+\d|Chicago|New York|London|Tokyo|Singapore|Toronto|Vancouver|Sydney|Hong Kong|India|Korea|Israel|Germany|France|UK|USA|Inc\.|Ltd\.|Corp\.|Company|plc|Corp|International|Inc|CORPORATION|HOLDINGS|MANAGEMENT|SYSTEMS/i.test(str)) return false;
    
    // Must have actual letters (not just numbers/symbols)
    if (!/[a-zA-Z]/.test(str)) return false;
    
    // Should have at least 2 letters (rules out single initials or weird chars)
    if ((str.match(/[a-zA-Z]/g) || []).length < 2) return false;
    
    return true;
  };
  
  // Pattern 0: Former Name / Former Address if changed since last report
  // This captures name changes for companies that changed names
  let formerMatch = text.match(/Former\s+(?:Name|Address)\s*(?:Changed\s+)?(?:Since\s+)?(?:Last\s+)?(?:Report|Submission)\s*[:\-]?\s*\n?\s*([^\n,]+?)(?:\n|$)/i);
  if (formerMatch && formerMatch[1]) {
    let formerName = formerMatch[1].trim().replace(/\s+/g, ' ');
    if (isValidName(formerName)) return formerName.substring(0, 150);
  }
  
  // Pattern 0b: Alternative pattern - "Name Changed from" or "Previously known as"
  let changedMatch = text.match(/(?:Name\s+)?(?:Changed|Previously|Formerly|Known)\s+(?:from|as)\s*[:\-]?\s*\n?\s*([^\n,]+?)(?:\n|$)/i);
  if (changedMatch && changedMatch[1]) {
    let changedName = changedMatch[1].trim().replace(/\s+/g, ' ');
    if (isValidName(changedName)) return changedName.substring(0, 150);
  }
  
  // Pattern 1: Signature block - "Name: XXXXX" after /s/ or "By:" line
  // Captures: "Name: Rajesh Magow" or "Name: Wes Levitt" or "Name: CHUN Sang Yung"
  let match = text.match(/Name\s*[:\-]\s*\n?\s*([^\n\/,]+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name.substring(0, 150);
  }
  
  // Pattern 2: "By: /s/ XXXXX" signature line - extract name after /s/
  match = text.match(/By\s*:?\s*\/s\/\s*([^\n\/]+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name.substring(0, 150);
  }
  
  // Pattern 3: Direct "APPLICANT:" label with name on next line
  match = text.match(/APPLICANT\s*[:\-]?\s*\n\s*([^\n]+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name.substring(0, 150);
  }
  
  // Pattern 4: "Applicant Name: XXXXX"
  match = text.match(/Applicant\s+Name\s*[:\-]\s*([^\n,]+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name.substring(0, 150);
  }
  
  // Pattern 5: Officer title + name (CEO, President, Secretary, CFO, etc.)
  match = text.match(/(?:Chief\s+Executive\s+Officer|CEO|President|Secretary|Chief\s+Financial\s+Officer|CFO|Chief\s+Investment\s+Officer|CIO|Deputy\s+Company\s+Secretary)\s*[:\-]?\s*\n\s*([^\n\/]+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name.substring(0, 150);
  }
  
  // Pattern 6: "Filer Name: XXXXX" or "Registrant Name: XXXXX"
  match = text.match(/(?:Filer|Registrant)\s+Name\s*[:\-]\s*([^\n,]+?)(?:\n|$)/i);
  if (match && match[1]) {
    let name = match[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name.substring(0, 150);
  }
  
  return null;
};

const detectCustodianBanks = (text) => {
  if (!text) return false;
  
  const lowerText = text.toLowerCase();
  
  // Pattern 1: Custodian bank designations (word boundaries prevent false matches)
  // Looks for "jpmorgan" or "j.p. morgan" as custodian or depositary
  const custodianPatterns = [
    { pattern: /\b(jpmorgan|j\.p\.\s*morgan|jp\s*morgan)\s*(chase|bank|services|as\s*custodian|as\s*depositary)/, name: 'JPMorgan Chase' },
    { pattern: /\b(citibank|citicorp|citi\s*bank)\s*(as\s*custodian|as\s*depositary|bank|n\.a\.)/, name: 'Citibank' },
    { pattern: /\bcitigroup\s*(inc|bank)/, name: 'Citigroup' },
    { pattern: /\bbny\s*mellon|bny\s*mellon|bank\s*of\s*new\s*york\s*mellon/, name: 'BNY Mellon' },
    { pattern: /\bdeutsche\s*bank/, name: 'Deutsche Bank' },
    { pattern: /\bstate\s*street\s*(bank|corporation)/, name: 'State Street' },
    { pattern: /\bwilmington\s*trust/, name: 'Wilmington Trust' }
  ];
  
  // Check custodian bank patterns with word boundaries
  for (const { pattern, name } of custodianPatterns) {
    if (pattern.test(lowerText)) {
      return { custodian: name, verified: true };
    }
  }
  
  // Pattern 2: Form F-6 filing (official ADR registration)
  // F-6 is specifically for ADR registration with SEC
  if (/form\s*f-6|f-6\s*registration|depositary\s*form\s*f-6/.test(lowerText)) {
    return { custodian: 'Form F-6 ADR', verified: true };
  }
  
  // Pattern 3: ADR program language in actual context
  // "American Depositary Receipt program" or "ADR program established"
  if (/american\s*depositary\s*receipt\s*(program|shares?|securities?)|adr\s*(program|shares?|securities?)\s*(for|of|issued)/i.test(lowerText)) {
    return { custodian: 'ADR Program', verified: true };
  }
  
  // Pattern 4: Foreign private issuer + depositary language together
  // Both must appear - reduces false positives
  const hasForeignPrivateIssuer = /foreign\s*private\s*issuer/.test(lowerText);
  const hasDepositaryRef = /depositary|depositary\s*(shares?|bank|agreement)/.test(lowerText);
  if (hasForeignPrivateIssuer && hasDepositaryRef) {
    return { custodian: 'Foreign Depositary', verified: true };
  }
  
  return false;
};

// S/O Bonus Multiplier - tighter float = stronger move potential
// High S/O (tight float) = 1.0-1.1x bonus based on float percentage
// Calculate WA from intraday data (High, Low, Close, Volume)
const calculateWAFromBars = (bars) => {
  if (!bars || bars.length === 0) return null;
  
  let totalVolumePrice = 0;
  let totalVolume = 0;
  
  for (const bar of bars) {
    const high = parseFloat(bar.high || bar.h);
    const low = parseFloat(bar.low || bar.l);
    const close = parseFloat(bar.close || bar.c);
    const volume = parseFloat(bar.volume || bar.v);
    
    if (high > 0 && low > 0 && close > 0 && volume > 0) {
      const typicalPrice = (high + low + close) / 3;
      totalVolumePrice += typicalPrice * volume;
      totalVolume += volume;
    }
  }
  
  if (totalVolume > 0) {
    return (totalVolumePrice / totalVolume).toFixed(2);
  }
  
  return null;
};

// Detect if registrant is hiding former name/address (suspicious signal)
const detectFormerNameHidden = (text) => {
  if (!text) return false;
  
  // Look for the "Former name or former address" field with NOT APPLICABLE or N/A
  const match = text.match(/(?:Former\s+name|former\s+address|changed\s+since\s+last\s+report)\s*[:\-]?\s*([^\n]+?)(?:\n|$)/i);
  
  if (match && match[1]) {
    const value = match[1].trim().toUpperCase();
    // If it explicitly says "NOT APPLICABLE", "N/A", "NA", this is a red flag
    if (/NOT\s*APPLICABLE|N\/A|^NA$/.test(value)) {
      return true;  // Registrant is hiding previous identity
    }
  }
  
  return false;
};

// Returns { direction: 'LONG' | 'SHORT', confidence: 0-1 }
// SIMPLIFIED FOR AMM SPEED: Quick categorization based on catalyst strength
const determineDirection = (signals = [], country = '', float = null, price = null) => {
  const signalArray = Array.isArray(signals) ? signals : (signals ? String(signals).split(',').map(s => s.trim()) : []);
  
  // Fast-track bankruptcy indicators (force SHORT immediately)
  const deathSpiral = ['Bankruptcy Filing', 'Credit Default', 'Executive Liquidation', 'Going Dark'].some(cat => signalArray.includes(cat));
  if (deathSpiral) {
    return { direction: 'SHORT', confidence: 0.85 };
  }
  
  // Heavyweight bearish signals that override isolated bullish catalysts
  const heavyweightBearish = ['Regulatory Breach', 'Accounting Restatement', 'Auditor Change'];
  const hasHeavyweightBearish = heavyweightBearish.some(cat => signalArray.includes(cat));
  
  // Moderate bearish (only count when reinforced by heavyweight or structural signals)
  const moderateBearish = ['Nasdaq Delisting', 'Bid Price Delisting', 'Reverse Split Event'];
  const structuralBearish = ['Convertible Debt'];
  
  // Bullish signals (including confidence signals like buybacks)
  const bullishSignals = ['Insider Buying', 'FDA Approved', 'Clinical Success', 'Clinical Milestone', 'Partnership', 'Licensing Deal', 'Government Contract', 'Stock Buyback', 'DTC Eligible Restored', 'Commercial Inflection'];
  
  // Asset Disposition is context-dependent: only bearish if paired with distress signals
  const hasAssetDisposition = signalArray.includes('Asset Disposition');
  const isDistressedDisposition = hasAssetDisposition && (signalArray.includes('Bankruptcy Filing') || signalArray.includes('Credit Default') || signalArray.includes('Going Dark'));
  
  const heavyweightCount = heavyweightBearish.filter(cat => signalArray.includes(cat)).length;
  const moderateCount = moderateBearish.filter(cat => signalArray.includes(cat)).length;
  const structuralCount = structuralBearish.filter(cat => signalArray.includes(cat)).length;
  const bullishCount = bullishSignals.filter(cat => signalArray.includes(cat)).length;
  
  // Distressed Asset Disposition counts as additional bearish weight
  const totalBearish = heavyweightCount + moderateCount + structuralCount + (isDistressedDisposition ? 1 : 0);
  
  // Heavy/Moderate bearish always win if >= 2 combined
  if ((heavyweightCount + moderateCount) >= 2) {
    return { direction: 'SHORT', confidence: 0.70 };
  }
  
  // Distressed Asset Disposition + heavyweight = SHORT
  if (isDistressedDisposition && heavyweightCount >= 1) {
    return { direction: 'SHORT', confidence: 0.70 };
  }
  
  // Single heavyweight bearish + structural bearish = SHORT (only if 2+ structural)
  if (heavyweightCount >= 1 && structuralCount >= 2) {
    return { direction: 'SHORT', confidence: 0.65 };
  }
  
  // M&A logic: check if distressed or healthy
  const hasMergerAcquisition = signalArray.includes('Merger/Acquisition');
  if (hasMergerAcquisition) {
    // M&A + distressed signals = SHORT (desperate acquisition)
    if (heavyweightCount >= 1 || isDistressedDisposition || totalBearish >= 3) {
      return { direction: 'SHORT', confidence: 0.75 };
    }
    // M&A + 2+ bullish signals = LONG (healthy strategic acquisition)
    if (bullishCount >= 2) {
      return { direction: 'LONG', confidence: 0.80 };
    }
    // M&A alone or with minimal signals = LONG (default strategic move)
    return { direction: 'LONG', confidence: 0.70 };
  }
  
  // Fast-track pure growth catalysts (force LONG immediately) - only if no distress signals
  const pureBullishCatalysts = ['FDA Approved', 'Clinical Success', 'Clinical Milestone', 'Partnership', 'Licensing Deal', 'Commercial Inflection', 'Government Contract'].some(cat => signalArray.includes(cat));
  if (pureBullishCatalysts && !hasHeavyweightBearish && moderateCount === 0 && !isDistressedDisposition) {
    return { direction: 'LONG', confidence: 0.80 };
  }
  
  // Heavy/Moderate bearish significantly outweigh bullish = SHORT (need 2+ bearish)
  if ((heavyweightCount + moderateCount) >= 2 && (heavyweightCount + moderateCount) > bullishCount) {
    return { direction: 'SHORT', confidence: 0.65 };
  }
  
  // Default LONG for everything else (safer for AMM pre-pricing)
  return { direction: 'LONG', confidence: 0.50 };
};

// Filing Time Multiplier - 1.2x boost for 30 mins before/after market open & close (9:30am & 4:00pm ET)
// 30 mins before/after open = strongest potential for price moves
const getFilingTimeMultiplier = (filingDateString) => {
  try {
    const filingTime = new Date(filingDateString);
    const etTime = new Date(filingTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = etTime.getHours();
    const minutes = etTime.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    
    let timeMultiplier = 1.0;
    
    // Peak: 9:00-10:00am (540-600) & 3:30-4:30pm (930-1020) = 1.2x (30 mins before/after market open/close)
    if ((totalMinutes >= 540 && totalMinutes <= 600) || (totalMinutes >= 930 && totalMinutes <= 1020)) {
      timeMultiplier = 1.2;
    }
    // Strong: 8:30-11:00am (510-660) & 2:30-5:00pm (870-1080) = 1.15x
    else if ((totalMinutes >= 510 && totalMinutes <= 660) || (totalMinutes >= 870 && totalMinutes <= 1080)) {
      timeMultiplier = 1.15;
    }
    // Good: 8:00am-12:00pm (480-720) & 2:00pm-5:30pm (840-1110) = 1.10x
    else if ((totalMinutes >= 480 && totalMinutes <= 720) || (totalMinutes >= 840 && totalMinutes <= 1110)) {
      timeMultiplier = 1.10;
    }
    // Other trading hours: 4am-6pm (240-1080) = 1.05x
    else if (totalMinutes >= 240 && totalMinutes <= 1080) {
      timeMultiplier = 1.05;
    }
    // Outside 4am-6pm: no bonus
    else {
      timeMultiplier = 1.0;
    }
    
    return timeMultiplier;
  } catch (e) {
    return 1.0;
  }
};

// Global Attention Window Bonus - TIER system for max gap-up potential
// 18:01 (Asian open), 13:21 (Euro close/US lunch), 21:01 (Overnight dark pool)
const getGlobalAttentionBonus = (filingDateString) => {
  try {
    const filingTime = new Date(filingDateString);
    const etTime = new Date(filingTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = etTime.getHours();
    const minutes = etTime.getMinutes();
    
    let bonus = 1.0;
    let tier = 'None';
    
    // TIER 1: GOLDEN HOURS (1.3x) - Asian open catalyst + overnight dark pool
    // 18:00-19:00 ET (Asia waking up at 7am+)
    // 21:00-22:00 ET (whole night for accumulation, Asia at 10am+ midday)
    if ((hours === 18 && minutes <= 59) || (hours === 21 && minutes <= 59)) {
      bonus = 1.3;
      tier = 'Golden';
      // Closeness bonus: exact :01 = 1.05x multiplier, :59 = 1.01x
      const closenessBonus = 1.0 + (Math.max(0, 60 - Math.abs(minutes - 1)) / 1200);
      bonus = bonus * closenessBonus;
    }
    // TIER 2: SILVER HOURS (1.15x) - Pre/post golden windows
    // 17:00-18:00 ET (pre-Asian open prep)
    // 20:00-21:00 ET (pre-overnight accumulation)
    // 13:00-14:00 ET (post-lunch dead zone, Europe 6pm)
    // 12:00-13:00 ET (lunch start)
    else if ((hours === 17) || (hours === 20) || (hours === 13) || (hours === 12)) {
      bonus = 1.15;
      tier = 'Silver';
      // Closeness bonus for tier 2
      const closenessBonus = 1.0 + (Math.max(0, 60 - Math.abs(minutes - 1)) / 1500);
      bonus = bonus * closenessBonus;
    }
    // TIER 3: BRONZE HOURS (1.05x) - Extended after-hours window
    // 22:00-04:00 ET (dark pool extended hours)
    // 16:00-17:00 ET (afternoon slump before prep)
    // 09:30-12:00 ET (morning session weaker)
    else if ((hours >= 22 || hours <= 4) || (hours === 16) || (hours >= 9 && hours <= 11)) {
      bonus = 1.05;
      tier = 'Bronze';
    }
    
    return { bonus: parseFloat(bonus.toFixed(4)), tier };
  } catch (e) {
    return { bonus: 1.0, tier: 'None' };
  }
};


const log = (level, message) => {
  let titleColor = '\x1b[90m';
  let messageColor = '\x1b[32m';

  if (level === 'ERROR') {
    titleColor = '\x1b[31m';
    messageColor = '\x1b[31m';
  } else if (level === 'WARN') {
    titleColor = '\x1b[33m';
    messageColor = '\x1b[33m';
  } else if (level === 'ALERT') {
    titleColor = '\x1b[91m';
    messageColor = '\x1b[91m';
  } else if (level === 'SKIP') {
    titleColor = '\x1b[90m';
    messageColor = '\x1b[31m';
  } else if (level === 'INFO') {
    titleColor = '\x1b[90m';
    messageColor = '\x1b[92m';
  } else if (level === 'AUTH') {
    titleColor = '\x1b[90m';
    messageColor = '\x1b[92m';
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
  const timestamp = `${dateStr} ${timeStr}`;
  console.log(`\x1b[90m[${timestamp}] ${titleColor}${level}:\x1b[0m ${messageColor}${message}\x1b[0m`);
};

const logGray = (level, message) => {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
  const timestamp = `${dateStr} ${timeStr}`;
  console.log(`\x1b[90m[${timestamp}] ${level}:\x1b[0m \x1b[90m${message}\x1b[0m`);
};

// Ensure logs directory exists
if (!fs.existsSync('logs')) {
  try {
    fs.mkdirSync('logs', { recursive: true });
  } catch (err) {
    console.error('Failed to create logs directory:', err.message);
  }
}

const FORM_TYPES = ['6-K', '6-K/A', '8-K', '8-K/A', 'S-1', 'S-3', 'S-4', 'S-8', 'F-1', 'F-3', '	SC TO-C', 'SC14D9C', 'S-9', 'F-4', 'FWG', '424B1', '424B2', '424B3', '424B4', '424B5', '424H8', '20-F', '20-F/A', '13G', '13G/A', '13D', '13D/A', 'Form D', 'EX-99.1', 'EX-99.2', 'EX-10.1', 'EX-10.2', 'EX-3.1', 'EX-3.2', 'EX-4.1', 'EX-4.2', 'EX-10.3', 'EX-1.1', 'Item 1.01', 'Item 1.02', 'Item 1.03', 'Item 1.04', 'Item 1.05', 'Item 2.01', 'Item 2.02', 'Item 2.03', 'Item 2.04', 'Item 2.05', 'Item 2.06', 'Item 3.01', 'Item 3.02', 'Item 3.03', 'Item 4.01', 'Item 5.01', 'Item 5.02', 'Item 5.03', 'Item 5.04', 'Item 5.05', 'Item 5.06', 'Item 5.07', 'Item 5.08', 'Item 5.09', 'Item 5.10', 'Item 5.11', 'Item 5.12', 'Item 5.13', 'Item 5.14', 'Item 5.15', 'Item 6.01', 'Item 7.01', 'Item 8.01', 'Item 9.01'];
const SEMANTIC_KEYWORDS = {

  // M&A & Structural
  'Merger/Acquisition': ['Merger Agreement', 'Acquisition Agreement', 'Agreed To Acquire', 'Merger Consideration', 'Premium Valuation', 'Going Private', 'Take Private', 'Acquisition Closing', 'Closing Of Acquisition', 'Completed Acquisition', 'Definitive Agreement To Be Acquired', 'Material Definitive Agreement', 'Strategic Alternatives', 'Exploring Strategic Alternatives'],
  
  // Biotech FDA (Clinical & Regulatory)
  'FDA Approved': ['FDA Approval', 'FDA Clearance', 'Approval Granted', 'Approval Letter', 'FDA Approves', 'FDA approved', 'EMA Approval', 'Post-Market Approval', 'PMA Approval', '510(k) Clearance', 'De Novo Clearance'],
  'FDA Breakthrough': ['Breakthrough Therapy', 'Breakthrough Designation', 'Fast Track Designation', 'Priority Review', 'Priority Status'],
  'FDA Filing': ['NDA Submission', 'NDA Filed', 'BLA Submission', 'BLA Filed', 'IND Application', 'Regulatory Filing'],
  'Clinical Success': ['Positive Trial Results', 'Phase 3 Success', 'Topline Results Beat', 'Efficacy Demonstrated', 'Safety Profile Met', 'Positive Results', 'Phase 1', 'Phase 2', 'Phase 3', 'Trial Results', 'Efficacy', 'Safety Profile', 'Cohort Results', 'Primary Endpoint', 'Enrollment Complete', 'Data Readout', 'Topline Data', 'Meaningful Improvement', 'Beat Placebo', 'Mechanism Of Action', 'Biomarker', 'Favorable Safety', 'Separation From Placebo', 'Demonstrated Benefit', 'Clinical Benefit', 'Strong Efficacy', 'Primary Endpoint Met', 'Statistically Significant', 'Met Primary Endpoint', 'Positive Phase 3', 'Positive Topline Results'],
  'Clinical Milestone': ['Phase Advancement', 'Phase 2 Initiation', 'Phase 3 Initiation', 'Enrollment Opened', 'Enrollment Initiated', 'Trial Initiation', 'Investigational New Drug', 'IND Application', 'NDA Filing', 'PMA Submission', 'Clinical Trial Site', 'Patient Enrollment', 'First Patient', 'Program Initiation', 'Patient Dosed', 'First Dose', 'Dose Escalation', 'Cohort Complete'],
  
  // Capital & Dilution
  'Capital Raise': ['Oversubscribed', 'Institutional Participation', 'Lead Investor', 'Top-Tier Investor', 'Strategic Investor'],
  'Underwritten Offering': ['Bought Deal', 'Underwriter Commitment', 'Underwritten Bought Deal', 'IPO', 'IPO Underwritten'],
  'Convertible Debt': ['Convertible Bonds', 'Convertible Notes', 'Convertible Securities'],
  
  // Distress & Legal
  'Bankruptcy Filing': ['Bankruptcy Protection', 'Chapter 11 Filing', 'Chapter 7 Filing', 'Insolvency Proceedings', 'Creditor Protection'],
  'Credit Default': ['Loan Default', 'Debt Covenant Breach', 'Event Of Default', 'Credit Agreement Violation', 'Covenant Breach', 'Default Event', 'Acceleration Of Debt', 'Mandatory Prepayment'],
  'Accounting Restatement': ['Financial Restatement', 'Audit Non-Reliance', 'Material Weakness', 'Control Deficiency', 'Audit Adjustment', 'Non-Reliance On Previously Issued Financial Statements', 'Previously Issued Financial Statements', 'Substantial Doubt About Ability To Continue As A Going Concern', 'Going Concern Uncertainty', 'Substantial Doubt'],
  'Auditor Change': ['Auditor Resigned', 'Audit Firm Changed', 'Auditor Departure', 'Internal Controls Weakness', 'Auditor No Longer', 'Changes Auditor', 'Change Of Auditor'],
  'Material Lawsuit': ['Material Litigation', 'Lawsuit Filed', 'Major Lawsuit', 'SEC Investigation', 'DOJ Investigation'],
  'Regulatory Breach': ['Regulatory Violation', 'FDA Warning', 'Product Recall', 'Safety Recall', 'Warning Letter'],
  
  // Structural Events
  'Going Dark': ['Form 15', 'Deregistration', 'Stop Reporting', 'Cease Reporting', 'Edgar Delisting', 'No Longer Report', 'Deregister', 'Terminate Registration', 'Exit From SEC Reporting', 'Shall No Longer File'],
  'Nasdaq Delisting': ['Nasdaq Deficiency', 'Listing Standards Warning', 'Nasdaq Notification', 'Delisting Determination', 'Nasdaq Letter', 'Delisting Risk', 'Delisting Threat', 'Received Notice Of Delisting', 'Notice Of Non-Compliance', 'Not In Compliance With Listing Requirements'],
  'Bid Price Delisting': ['Minimum Bid Price', 'Regained Compliance'],
  'Reverse Split Event': ['Reverse Split Completed', 'Reverse Consolidation', 'Recent Consolidation', 'Reverse Split', 'Reverse Stock Split', 'Consolidation Of Shares', 'Stock Split Reverse', 'Share Consolidation Event', 'Split Reverse', 'Reverse Recapitalization'],
  'DTC Eligible Restored': ['DTC Eligible', 'DTC Chill Lifted', 'Eligibility Restored', 'DTC Restoration', 'Chill Status', 'Chill Removed', 'Resume Trading'],
  
  // Operational Catalysts
  'Asset Disposition': ['Asset Sale', 'Asset Disposition', 'Business Disposition', 'Sold Assets', 'Divesting', 'Asset Divestiture', 'Strategic Sale', 'Sale Of Assets', 'Disposition', 'Divested'],
  'Stock Buyback': ['Share Repurchase', 'Buyback Authorization', 'Accelerated Buyback', 'Repurchase Program'],
  'Executive Departure': ['CEO Departed', 'CFO Departed', 'CEO Resigned', 'Chief Officer Left', 'CEO Resignation', 'CFO Departure', 'Stepped Down', 'Stepped Down From Role', 'Step Down', 'Planned Leadership Transition'],
  
  // Growth Catalysts (Press Release Quality)
  'Partnership': ['Strategic Partnership', 'Joint Venture', 'Partnership Agreement', 'Strategic Alliance', 'Development Agreement'],
  'Licensing Deal': ['Exclusive License', 'License Agreement', 'Technology License', 'IP Licensing'],
  'Government Contract': ['Government Contract Award', 'Defense Contract', 'Federal Contract', 'DOD Contract', 'GSA Schedule', 'Federal Procurement'],
  
  // Commercial Inflection & Traction (Growth Signals)
  'Commercial Inflection': ['Customer Growth', 'Revenue Growth', 'Revenue Doubled', 'Revenue Doubled In', 'Commercial Traction', 'Commercial Momentum', 'POC Completed', 'Proof Of Concept Completed', 'Proof Of Concept', 'Letter Of Intent', 'LOI Signed', 'Commercial Pipeline Expansion', 'Commercial Pipeline', 'Operational Runway', 'Cash Runway', 'Strengthened Foundation', 'De-Risking', 'Strategic Validation', 'Ecosystem Expansion', 'Customer Count Increase', 'Active Customers', 'Revenue-Generating Shipments', 'Repeat Business'],
};



// FINANCIAL RATIO PARSER - Extract & analyze balance sheet metrics
// Financial ratio parser: extracts quantitative balance sheet metrics from filing text
const parseFinancialRatios = (filingText) => {
  if (!filingText) return { signals: [], severity: 0 };
  
  const signals = [];
  let severity = 0;
  
  // Current Ratio parser (liquidity crisis threshold = 0.5)
  const currentRatioMatch = filingText.match(/current ratio[:\s]+([0-9.]+)/i);
  if (currentRatioMatch) {
    const ratio = parseFloat(currentRatioMatch[1]);
    if (ratio < 0.2) {
      signals.push('Liquidity Crisis - Current Ratio Below 0.2');
      severity = Math.max(severity, 0.95); // Near certain bankruptcy
    } else if (ratio < 0.5) {
      signals.push('Liquidity Shortage - Current Ratio Below 0.5');
      severity = Math.max(severity, 0.80);
    } else if (ratio < 1.0) {
      signals.push('Liquidity Concern - Current Ratio Below 1.0');
      severity = Math.max(severity, 0.60);
    }
  }
  
  // Working Capital parser (negative = can't pay bills)
  const wcMatch = filingText.match(/working capital[:\s]+\(([0-9,.]+)\)|working capital[:\s]*-([0-9,.]+)|working capital[:\s]+\$?\(?([0-9,]+)\)?M/i);
  if (wcMatch) {
    const wcText = (wcMatch[1] || wcMatch[2] || wcMatch[3] || '').replace(/[,$M]/g, '');
    const wc = parseFloat(wcText);
    if (wc < -10000000) { // < -$10M
      signals.push('Massive Working Capital Deficit (WC < -$10M)');
      severity = Math.max(severity, 0.85);
    } else if (wc < 0) {
      signals.push('Working Capital Deficit (WC < 0)');
      severity = Math.max(severity, 0.70);
    }
  }
  
  // Book Value per Share parser (negative = insolvent on paper)
  const bvpsMatch = filingText.match(/book value per share[:\s]+\$?([0-9.-]+)|equity.*per share[:\s]+\$?([0-9.-]+)/i);
  if (bvpsMatch) {
    const bvps = parseFloat(bvpsMatch[1] || bvpsMatch[2]);
    if (bvps < 0) {
      signals.push('Negative Book Value Per Share (BVPS < 0)');
      severity = Math.max(severity, 0.90); // Technically insolvent
    }
  }
  
  // Net Cash parser (negative debt = more debt than cash)
  const netCashMatch = filingText.match(/net cash[:\s]+\(?([0-9,.-]+)\)?M|net debt[:\s]+\$?([0-9,.-]+)M/i);
  if (netCashMatch) {
    const ncText = (netCashMatch[1] || netCashMatch[2] || '').replace(/[,$M]/g, '');
    const nc = parseFloat(ncText);
    if (nc < -5000) { // < -$5B
      signals.push('Severe Net Debt Position - Over $5B');
      severity = Math.max(severity, 0.75);
    } else if (nc < 0) {
      signals.push('Net Debt Position');
      severity = Math.max(severity, 0.65);
    }
  }
  
  // Debt/Equity parser (> 2.0 = highly leveraged)
  const deMatch = filingText.match(/debt.*equity[:\s]+([0-9.]+)|leverage ratio[:\s]+([0-9.]+)/i);
  if (deMatch) {
    const de = parseFloat(deMatch[1] || deMatch[2]);
    if (de > 3.0) {
      signals.push('High Leverage - Debt/Equity Exceeds 3.0');
      severity = Math.max(severity, 0.75);
    } else if (de > 2.0) {
      signals.push('Leverage Concern - Debt/Equity Exceeds 2.0');
      severity = Math.max(severity, 0.65);
    }
  }
  
  // Interest Coverage parser (< 1.0 = can't service debt)
  const icMatch = filingText.match(/interest coverage[:\s]+([0-9.]+)|times interest earned[:\s]+([0-9.]+)/i);
  if (icMatch) {
    const ic = parseFloat(icMatch[1] || icMatch[2]);
    if (ic < 0.5) {
      signals.push('Debt Service Risk - Interest Coverage Below 0.5');
      severity = Math.max(severity, 0.85);
    } else if (ic < 1.0) {
      signals.push('Debt Service Concern (IC < 1.0)');
      severity = Math.max(severity, 0.75);
    }
  }
  
  return { signals, severity };
};

// 1. DTC Chill Lift Detector
const detectDTCChillLift = (text) => {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  const liftPatterns = ['dtc chill lifted', 'dtc eligibility restored', 'dtc eligible', 'shares are now dtc eligible', 'dtc has restored'];
  return liftPatterns.some(p => lowerText.includes(p)) ? 'DTC_CHILL_LIFT' : null;
};

// 2. Batch Filing Detector - Same lawyer + same items + 60min window = coordinated
const detectBatchFiling = (allFilings) => {
  if (!allFilings || allFilings.length < 2) return [];
  
  const batchClusters = [];
  const lawyerClusters = {};
  
  // Group by law firm
  for (const filing of allFilings) {
    const title = (filing.title || '').toLowerCase();
    let firm = null;
    
    if (title.includes('hunter taubman') || title.includes('hunter')) {
      firm = 'Hunter Taubman';
    } else if (title.includes('ellenoff')) {
      firm = 'Ellenoff';
    } else if (title.includes('sichenzia')) {
      firm = 'Sichenzia';
    }
    
    if (firm) {
      if (!lawyerClusters[firm]) lawyerClusters[firm] = [];
      lawyerClusters[firm].push(filing);
    }
  }
  
  // Check for batches: same firm + 3+ filings within 60 minutes
  for (const [firm, filings] of Object.entries(lawyerClusters)) {
    if (filings.length >= 3) {
      const times = filings.map(f => new Date(f.updated).getTime());
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const diffMin = (maxTime - minTime) / 60000;
      
      if (diffMin <= 60) {
        batchClusters.push({
          firm,
          count: filings.length,
          minuteSpan: Math.round(diffMin),
          tickers: filings.map(f => f.title.match(/\b[A-Z]{1,5}\b/)?.[0]).filter(Boolean)
        });
      }
    }
  }
  
  return batchClusters;
};

// 3. Form 15 + Name Change Together - Shell recycling pattern
const detectShellRecycling = (text) => {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  
  const hasForm15 = lowerText.includes('form 15') || lowerText.includes('going dark');
  const hasNameChange = lowerText.includes('name change') || lowerText.includes('certificate of amendment') || 
                        lowerText.includes('change of company name') || lowerText.includes('formerly known as');
  
  return (hasForm15 && hasNameChange) ? 'Shell Recycling' : null;
};

// 4. VStock Transfer Agent Detection - Transfer agent rotation indicator
const detectVStockTransferAgent = (text) => {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  
  const patterns = [
    { from: /equity stock transfer/i, to: /vstock transfer/i, signal: 'VStock Setup' },
    { from: /continental stock/i, to: /vstock transfer/i, signal: 'VStock Setup' },
    { from: /[\w\s]+/i, to: /vstock transfer|island stock transfer/i, signal: 'VStock Setup' }
  ];
  
  const hasVStock = /vstock|island stock transfer/i.test(lowerText);
  const hasTransferAgent = /transfer agent|stock transfer/i.test(lowerText);
  
  return (hasVStock && hasTransferAgent) ? 'VStock Setup' : null;
};

// 5. NT 10-K → Actual 10-K Cycle (Chinese ADRs) - Filing cycle pattern
const detectNT10KCycle = (text, filingType) => {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  
  const isChinese = lowerText.includes('prc') || lowerText.includes('china') || 
                    lowerText.includes('cayman') || lowerText.includes('bvi') ||
                    lowerText.includes('shanghai') || lowerText.includes('beijing');
  
  if (!isChinese) return null;
  
  // Check if it's an NT 10-K (late filing notification)
  if (lowerText.includes('nt 10-k') || lowerText.includes('notification of late') || 
      lowerText.includes('we are unable to file') || lowerText.includes('form 12b-25')) {
    return 'NT 10K Filed';
  }
  
  // Check if it's the actual 10-K after NT
  if (filingType && filingType.includes('10-K') && !lowerText.includes('nt 10-k')) {
    return 'Actual 10K Filed';
  }
  
  return null;
};

// 6. Third-Party Services Detection - Proxy solicitors, M&A advisors, transfer agents
const detectThirdPartyServices = (text) => {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  
  const services = {
    'D.F. King': /d\.f\.\s*king|df king/i,
    'MacKenzie Partners': /mackenzie partners/i,
    'Innisfree M&A': /innisfree/i,
    'Okapi Partners': /okapi partners/i,
    'Sard Verbinnen': /sard verbinnen/i,
    'Weinstein PR': /weinstein/i,
    'PCG Advisory': /pcg advisory/i,
    'American Stock Transfer': /american stock transfer/i,
    'VStock Transfer': /vstock|island stock transfer/i
  };
  
  const detected = [];
  for (const [name, pattern] of Object.entries(services)) {
    if (pattern.test(lowerText)) {
      detected.push(name);
    }
  }
  
  return detected.length > 0 ? detected : null;
};

const SEC_CODE_TO_COUNTRY = {'C2':'Shanghai, China','F4':'Shadong, China','F8':'Bogota, Columbia','6A':'Shanghai, China','D8':'Hong Kong','H0':'Hong Kong','K3':'Kowloon Bay, Hong Kong','S4':'Singapore','U0':'Singapore','C0':'Cayman Islands','K2':'Cayman Islands','E9':'Cayman Islands','1E':'Charlotte Amalie, U.S. Virgin Islands','VI':'Road Town, British Virgin Islands','A1':'Toronto, Canada','A2':'Winnipeg, Canada','A6':'Ottawa, Canada','A9':'Vancouver, Canada','A0':'Calgary, Canada','CA':'Toronto, Canada','C4':'Toronto, Canada','D0':'Hamilton, Canada','D9':'Toronto, Canada','Q0':'Toronto, Canada','L3':'Tel Aviv, Israel','J1':'Tokyo, Japan','M0':'Tokyo, Japan','E5':'Dublin, Ireland','I0':'Dublin, Ireland','L2':'Dublin, Ireland','DE':'Wilmington, Delaware','1T':'Athens, Greece','B2':'Bridgetown, Barbados','B6':'Nassau, Bahamas','B9':'Hamilton, Bermuda','C1':'Buenos Aires, Argentina','C3':'Brisbane, Australia','C7':'St. Helier, Channel Islands','D2':'Hamilton, Bermuda','D4':'Hamilton, Bermuda','D5':'Sao Paulo, Brazil','D6':'Bridgetown, Barbados','E4':'Hamilton, Bermuda','F2':'Frankfurt, Germany','F3':'Paris, France','F5':'Johannesburg, South Africa','G0':'St. Helier, Jersey','G1':'St. Peter Port, Guernsey','G4':'New York, United States','G7':'Copenhagen, Denmark','H1':'St. Helier, Jersey','I1':'Douglas, Isle of Man','J0':'St. Helier, Jersey','J2':'St. Helier, Jersey','J3':'St. Helier, Jersey','K1':'Seoul, South Korea','K7':'New York, United States','L0':'Hamilton, Bermuda','L6':'Milan, Italy','M1':'Majuro, Marshall Islands','N0':'Amsterdam, Netherlands','N2':'Amsterdam, Netherlands','N4':'Amsterdam, Netherlands','O5':'Mexico City, Mexico','P0':'Lisbon, Portugal','P3':'Manila, Philippines','P7':'Madrid, Spain','P8':'Warsaw, Poland','R0':'Milan, Italy','S0':'Madrid, Spain','T0':'Lisbon, Portugal','T3':'Johannesburg, South Africa','U1':'London, United Kingdom','U5':'London, United Kingdom','V0':'Zurich, Switzerland','V8':'Geneva, Switzerland','W0':'Frankfurt, Germany','X0':'London, UK','X1':'Luxembourg City, Luxembourg','Y0':'Nicosia, Cyprus','Y1':'Nicosia, Cyprus','Y7':'St. Peter Port, Guernsey','Z0':'Johannesburg, South Africa','Z1':'Johannesburg, South Africa','Z4':'Vancouver, British Columbia, Canada','1A':'Pago Pago, American Samoa','1B':'Saipan, Northern Mariana Islands','1C':'Hagatna, Guam','1D':'San Juan, Puerto Rico','3A':'Sydney, Australia','4A':'Auckland, New Zealand','5A':'Apia, Samoa','7A':'Moscow, Russia','8A':'Mumbai, India','9A':'Jakarta, Indonesia','2M':'Frankfurt, Germany','U3':'Madrid, Spain','Y9':'Nicosia, Cyprus','AL':'Birmingham, UK','Q8':'Oslo, Norway','R1':'Panama City, Panama','V7':'Stockholm, Sweden','K8':'Jakarta, Indonesia','O9':'Monaco','W8':'Istanbul, Turkey','R5':'Lima, Peru','N8':'Kuala Lumpur, Malaysia'};

const parseSemanticSignals = (text) => {
  if (!text) return {};
  const lowerText = text.toLowerCase();
  const signals = {};
  
  for (const [category, keywords] of Object.entries(SEMANTIC_KEYWORDS)) {
    const matches = keywords.filter(kw => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      return regex.test(lowerText);
    });
    if (matches.length > 0) {
      signals[category] = matches;
    }
  }
  
  return signals;
};


const extractReverseSplitRatio = (text) => {
  if (!text) return null;
  
  // Priority 1: Look for explicit reverse split announcements with ratios
  // Pattern: "reverse split of... at a ratio of 1-for-X" or "1-for-X reverse stock split"
  let match = text.match(/reverse\s+(?:split|combination|consolidation).*?(?:ratio|at)\s+(?:of\s+)?1\s*(?:-|for)\s*(\d+)/i);
  if (match && match[1]) {
    return `1-for-${match[1]}`;
  }
  
  // Priority 2: Look for "approved a ... 1-for-X" followed by "reverse"
  match = text.match(/approved.*?1\s*(?:-|for)\s*(\d+)\s*.*?reverse/i);
  if (match && match[1]) {
    return `1-for-${match[1]}`;
  }
  
  // Priority 3: Look for announcements with explicit ratio like "1-for-60"
  match = text.match(/(?:announces?|announced)\s+(?:a\s+)?1\s*(?:-|for)\s*(\d+)\s+reverse/i);
  if (match && match[1]) {
    return `1-for-${match[1]}`;
  }
  
  // Priority 4: Match "every X shares will be combined into one" pattern
  match = text.match(/every\s+(\d+)\s+(?:shares|ordinary shares).*?(?:will\s+)?(?:be\s+)?combined?\s+into\s+(?:one|1)\s+(?:share|post)/i);
  if (match && match[1]) {
    return `1-for-${match[1]}`;
  }
  
  // Priority 5: Context-aware 1-for-X match (avoids file numbers like 001-38857)
  // Must have "reverse", "split", "consolidation", "combination", or "stock" nearby
  match = text.match(/(reverse|split|consolidation|combination|stock)\s+.*?1\s*(?:-|for)\s*(\d{2,3})/i);
  if (match && match[2]) {
    const ratio = parseInt(match[2]);
    // Validate it's a reasonable split ratio (between 2 and 1000, not file number)
    if (ratio >= 2 && ratio <= 1000) {
      return `1-for-${match[2]}`;
    }
  }
  
  // Priority 6: Fallback - simple 1-for-X pattern anywhere in text (lenient)
  match = text.match(/1\s*(?:-|for)\s*(\d+)\s+(?:reverse|split|consolidation)/i);
  if (match && match[1]) {
    const ratio = parseInt(match[1]);
    if (ratio >= 2 && ratio <= 1000) {
      return `1-for-${match[1]}`;
    }
  }
  
  // Priority 7: Last resort - any 1-for-X with 2+ digits (but not file numbers)
  match = text.match(/1\s*(?:-|for)\s*(\d{2,})/);
  if (match && match[1]) {
    const ratio = parseInt(match[1]);
    if (ratio >= 2 && ratio <= 10000) { // Allow up to 10000
      return `1-for-${match[1]}`;
    }
  }
  
  return null;
};

// Extract Item Code context from filing (e.g., "Item 8.01", "Item 6.01")
const extractItemCode = (text) => {
  if (!text) return null;
  // Match "Item X.XX" patterns
  const itemMatch = text.match(/\bItem\s+([1-9]\.\d{2})\b/i);
  return itemMatch ? itemMatch[1] : null;
};

// Detect if Item 8.01 contains specific context (patent loss, lawsuit, etc.)
const getItem801Context = (text) => {
  if (!text) return null;
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('patent') && (lowerText.includes('revoked') || lowerText.includes('lost') || lowerText.includes('invalidated'))) {
    return 'Patent Loss';
  }
  if (lowerText.includes('lawsuit') || lowerText.includes('litigation') || lowerText.includes('settlement')) {
    return 'Material Lawsuit';
  }
  if (lowerText.includes('regulatory') && (lowerText.includes('violation') || lowerText.includes('investigation'))) {
    return 'Regulatory Loss';
  }
  return null;
};

// Extract insider buying amounts: CEO bought X shares @ $Y/share
const extractInsiderBuyingAmount = (text) => {
  if (!text) return { insiderAmount: null, insiderShares: null, participants: [] };
  
  const lowerText = text.toLowerCase();
  const result = { insiderAmount: null, insiderShares: null, participants: [] };
  
  // Match patterns like "CEO purchased 2,400,000 shares" or "2.4 million shares"
  const sharePatterns = [
    /(?:ceo|chairman|director|officer)\s+(?:purchased|bought|acquired)\s+([\d,]+)\s*(?:shares)?/gi,
    /(?:CEO|Chairman|Director|Officer).*?(\d+[\d,]*)\s*(?:shares|common stock)/gi
  ];
  
  let totalShares = 0;
  const participantSet = new Set();
  
  for (const pattern of sharePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const shares = parseInt(match[1].replace(/,/g, ''));
      if (!isNaN(shares) && shares > 0) {
        totalShares += shares;
        const title = match[0].match(/(?:CEO|Chairman|Director|Officer)/i);
        if (title) participantSet.add(title[0].toLowerCase());
      }
    }
  }
  
  // Try to extract price/amount: "at $X.XX per share" or "at $1.25/share"
  const priceMatch = text.match(/(?:at|@)\s*\$?([\d.]+)\s*(?:per\s+share|\/share|\s+share)/i);
  if (priceMatch && totalShares > 0) {
    const pricePerShare = parseFloat(priceMatch[1]);
    result.insiderAmount = (totalShares * pricePerShare).toFixed(0);
  }
  
  result.insiderShares = totalShares > 0 ? totalShares : null;
  result.participants = Array.from(participantSet);
  
  return result;
};

const detectDeterministicPatterns = (semanticSignals) => {
  if (!semanticSignals || Object.keys(semanticSignals).length === 0) {
    return { pattern: null, mechanism: null };
  }
  
  const signals = Object.keys(semanticSignals);
  
  // VALIDATED PATTERNS FROM HISTORICAL DATA (42 winners analyzed)
  // These patterns have proven track records from actual trading outcomes
  
  const hasNasdaqDelisting = signals.includes('Nasdaq Delisting');
  const hasBidPriceDelisting = signals.includes('Bid Price Delisting');
  const hasReverseSpliEvent = signals.includes('Reverse Split Event');
  
  // Note: Artificial Inflation category was deleted - reverse split signals handled via Reverse Split Event + Delisting categories
  
  // STRICT: Asset Disposition requires supporting signals (distress context)
  const hasAssetDisposition = signals.includes('Asset Disposition');
  const hasBankruptcy = signals.includes('Bankruptcy Filing');
  const hasExecutiveDeparture = signals.includes('Executive Departure');
  
  if (hasAssetDisposition && (hasBankruptcy || hasExecutiveDeparture)) {
    return {
      pattern: 'Asset Disposition (Distressed)',
      mechanism: 'Company liquidating assets in emergency context + leadership exodus = covenant breach scenario. Assets sold at discount, downward spiral.',
      direction: 'SHORT'
    };
  }
  
  // Asset disposition without distress signals = restructuring (LONG)
  if (hasAssetDisposition && signals.length >= 2 && !hasBankruptcy && !hasExecutiveDeparture) {
    return {
      pattern: 'Asset Disposition (Restructuring)',
      mechanism: 'Company optimizing portfolio, disposing non-core assets = better capital allocation. Often precedes M&A or turnaround.',
      direction: 'LONG'
    };
  }
  
  // STRICT: Clinical Success/Milestone requires 4+ signals minimum 
  const hasClinicalSuccess = signals.includes('Clinical Success');
  const hasClinicalMilestone = signals.includes('Clinical Milestone');
  const hasFDAApproved = signals.includes('FDA Approved');
  const hasFDAGranted = signals.includes('FDA Granted');
  
  if ((hasClinicalSuccess || hasClinicalMilestone) && signals.length >= 4) {
    return {
      pattern: 'Clinical Success / Milestone',
      mechanism: 'Biotech positive trial data or clinical milestone = de-risking narrative. Reduces probability of drug failure, increases commercialization likelihood.',
      direction: 'LONG'
    };
  }
  
  // Note: Share Consolidation deleted - reverse split delisting signals handled via Reverse Split Event + Delisting categories
  
  // M&A catalysts - STRICT: Merger/Acquisition only without other issues
  const hasMergerAcquisition = signals.includes('Merger/Acquisition');
  
  if (hasMergerAcquisition && signals.length <= 4) {
    return {
      pattern: 'Merger/Acquisition',
      mechanism: 'M&A catalyst = immediate upside catalyst. Market prices in deal value, synergies, and premium.',
      direction: 'LONG'
    };
  }
  
  // Covenant breach = distressed financing - Credit Default is key signal
  const hasCreditDefault = signals.includes('Credit Default');
  
  if (hasCreditDefault && signals.length >= 2) {
    return {
      pattern: 'Credit Default (Covenant Breach)',
      mechanism: 'Company in covenant breach with lenders = dilutive financing at distressed terms. Lenders have leverage.',
      direction: 'SHORT'
    };
  }
  
  // Going Dark + 2+ supporting signals = SHORT (deregistration catalyst)
  const hasGoingDark = signals.includes('Going Dark');
  
  if (hasGoingDark && signals.length >= 2) {
    return {
      pattern: 'Going Dark (Deregistration)',
      mechanism: 'Company filing Form 15 to stop SEC reporting. Deregistration = loss of liquidity, institutional selling forced.',
      direction: 'SHORT'
    };
  }
  
  // Auditor Change + 2+ supporting signals = SHORT (internal control weakness signal)
  const hasAuditorChange = signals.includes('Auditor Change');
  
  if (hasAuditorChange && signals.length >= 2) {
    return {
      pattern: 'Auditor Change (Control Weakness)',
      mechanism: 'Auditor departure or internal control material weakness = red flag. Often precedes negative restatement or going concern.',
      direction: 'SHORT'
    };
  }
  
  return { pattern: null, mechanism: null };
};

// Detect financing type: bought deal, registered direct, ATM, etc.
const detectFinancingType = (text) => {
  if (!text) return { type: 'Generic', multiplier: 1.0 };
  
  const lowerText = text.toLowerCase();
  
  // Bought Deal (underwriter-backed = confidence signal)
  if ((lowerText.includes('bought deal') || lowerText.includes('underwriter') || lowerText.includes('underwritten')) && lowerText.includes('offering')) {
    return { type: 'Underwritten Offering', multiplier: 1.20 };
  }
  
  // Registered Direct + insider buying = high confidence
  if (lowerText.includes('registered direct') && (lowerText.includes('ceo') || lowerText.includes('chairman') || lowerText.includes('director'))) {
    return { type: 'Registered Direct + Insider', multiplier: 1.25 };
  }
  
  // Registered Direct (no insider co-investment)
  if (lowerText.includes('registered direct')) {
    return { type: 'Registered Direct', multiplier: 1.10 };
  }
  
  // At-The-Market (opportunistic, dilutive)
  if (lowerText.includes('at-the-market') || lowerText.includes('atm offering')) {
    return { type: 'ATM Offering', multiplier: 0.95 };
  }
  
  // Generic public offering
  if (lowerText.includes('public offering') || lowerText.includes('secondary offering')) {
    return { type: 'Public Offering', multiplier: 0.98 };
  }
  
  return { type: 'Generic Raise', multiplier: 1.0 };
};

// Detect M&A close + rebrand as structural catalyst
const detectMACloseRebrand = (text) => {
  if (!text) return { isMAClosed: false, hasRebrand: false, multiplier: 1.0 };
  
  const lowerText = text.toLowerCase();
  
  const isMAClosed = (lowerText.includes('acquisition') || lowerText.includes('merger')) &&
                      (lowerText.includes('closing') || lowerText.includes('completed') || lowerText.includes('closed'));
  
  const hasRebrand = (lowerText.includes('name change') || lowerText.includes('company name') || lowerText.includes('ticker change')) &&
                     (lowerText.includes('formerly') || lowerText.includes('change to') || lowerText.includes('will be'));
  
  let multiplier = 1.0;
  if (isMAClosed && hasRebrand) {
    multiplier = 1.30; // Full M&A + rebrand = structural transformation signal
  } else if (isMAClosed) {
    multiplier = 1.15; // M&A closed = structural change
  }
  
  return { isMAClosed, hasRebrand, multiplier };
};

const getExchangePrefix = (ticker) => {
  // Map tickers to their exchanges for TradingView
  // Detect exchange based on ticker format, length, and patterns
  
  if (!ticker || ticker === 'Unknown') return 'NASDAQ';
  
  const upperTicker = ticker.toUpperCase();
  
  // OTC/Pink Sheet Indicators:
  // 1. Ticker length >= 5 characters (ABCDE format)
  // 2. Contains non-alphabetic characters (XXXX.L, XXXX.V, etc.)
  // 3. Ends with common OTC suffixes (.OB, .PK, .OTC, .BB)
  // 4. Explicit OTC mentions
  if (upperTicker.length >= 5) {
    return 'OTC';
  }

  // Non-alphabetic characters indicate international or OTC
  if (/[^A-Z]/.test(upperTicker)) {
    return 'OTC';
  }
  
  // Known NYSE stocks (blue chips) - map specific high-volume tickers
  const nyseStocks = ['F', 'GM', 'BAC', 'C', 'JPM', 'GE', 'XOM', 'CVX', 'T', 'VZ', 'WMT', 'KO', 'PEP', 'MCD', 'IBM', 'PG', 'JNJ', 'KMB', 'MRK', 'PFE'];
  if (nyseStocks.includes(upperTicker)) {
    return 'NYSE';
  }
  
  // Default to NASDAQ for 1-4 letter alphabetic tickers
  return 'NASDAQ';
};

const cleanupStaleAlerts = () => {
  try {
    if (!fs.existsSync(CONFIG.ALERTS_FILE)) return;
    
    const alerts = JSON.parse(fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8'));
    if (!Array.isArray(alerts) || alerts.length === 0) return;
    
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, 5 = Friday, 6 = Saturday
    
    // Monday-Thursday: wipe after 7 days
    // Friday-Sunday: wipe after 5 days (less stale data over weekend)
    const daysToKeep = (dayOfWeek >= 1 && dayOfWeek <= 4) ? 7 : 5;
    const cutoffTime = now.getTime() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    const filtered = alerts.filter(alert => {
      const alertTime = new Date(alert.recordedAt).getTime();
      return alertTime > cutoffTime;
    });
    
    if (filtered.length < alerts.length) {
      const removed = alerts.length - filtered.length;
      fs.writeFileSync(CONFIG.ALERTS_FILE, JSON.stringify(filtered, null, 2));
      log('INFO', `Cleanup: Removed ${removed} stale alerts (${daysToKeep} day policy)`);
    }
  } catch (err) {
    // Cleanup error - don't break the app
  }
};

const saveToCSV = (alertData) => {
  try {
    const csvPath = CONFIG.CSV_FILE;
    const headers = 'CIK,Ticker,Registrant Name,Price,Incorporated,Located,Market Cap,Float,Shares Outstanding,S/O Ratio,F/AV,Direction,FTD,FTD %,Volume,Average Volume,Sector,Filing Type,Catalyst,Custodian Control,Filing Time Bonus,S/O Bonus,Bonus Signals,Financial Ratios,Alert Type,Skip Reason,Filed Date,Filed Time,Scanned Date,Scanned Time\n';
    
    // Create file with headers if it doesn't exist
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, headers);
    }
    
    // Safely get missing fields with fallbacks
    const sector = alertData.sector || 'N/A';
    const wa = alertData.wa || 'N/A';
    const fav = alertData.fav || 'N/A';
    const companyName = alertData.companyName || 'N/A';
    const financialRatioSignals = alertData.financialRatioSignals || null;
    
    // Format filing timestamp
    const filingTime = new Date(alertData.filingDate);
    const filedDate = filingTime.toISOString().split('T')[0];
    const filedTime = filingTime.toTimeString().split(' ')[0];
    
    // Format scan timestamp
    const now = new Date();
    const scannedDate = now.toISOString().split('T')[0];
    const scannedTime = now.toTimeString().split(' ')[0];
    
    // Format signals/intent as readable string
    const signals = (alertData.intent && Array.isArray(alertData.intent)) 
      ? alertData.intent.join('; ').replace(/,/g, ';')
      : (alertData.intent ? String(alertData.intent).replace(/,/g, ';') : 'N/A');
    
    // Extract country (last part after comma if exists)
    let incorporated = alertData.incorporated || 'Unknown';
    if (incorporated.includes(',')) {
      const parts = incorporated.split(',');
      incorporated = parts[parts.length - 1].trim();
    }
    
    let located = alertData.located || 'Unknown';
    if (located.includes(',')) {
      const parts = located.split(',');
      located = parts[parts.length - 1].trim();
    }
    
    // Helper function to safely escape CSV values
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return 'N/A';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    // Format bonus signals
    let bonusSignalsStr = 'N/A';
    if (alertData.bonusSignals && typeof alertData.bonusSignals === 'object') {
      const bonusItems = [];
      if (alertData.bonusSignals['DTC Chill Lift']) bonusItems.push('DTC Chill Lift');
      if (alertData.bonusSignals['Shell Recycling']) bonusItems.push('Shell Recycling');
      if (alertData.bonusSignals['VStock']) bonusItems.push('VStock');
      if (alertData.bonusSignals['NT 10K'] === 'NT 10K Filed') bonusItems.push('NT 10-K Filed');
      if (alertData.bonusSignals['NT 10K'] === 'Actual 10K Filed') bonusItems.push('Actual 10-K');
      if (alertData.bonusSignals['Third Party'] && Array.isArray(alertData.bonusSignals['Third Party'])) {
        bonusItems.push(`Services: ${alertData.bonusSignals['Third Party'].join(';')}`);
      }
      if (bonusItems.length > 0) {
        bonusSignalsStr = bonusItems.join('; ');
      }
    }
    
    // Format financial ratio signals
    let financialRatiosStr = 'N/A';
    if (alertData.financialRatioSignals && alertData.financialRatioSignals.signals && Array.isArray(alertData.financialRatioSignals.signals)) {
      financialRatiosStr = alertData.financialRatioSignals.signals.join('; ') + ` [Severity: ${alertData.financialRatioSignals.severity.toFixed(2)}]`;
    }
    
    // Build CSV row with data - CIK first, Incorporated/Located after Price, date/time at end
    const csvWA = wa || 'N/A';
    const csvFAV = fav || 'N/A';
    const row = [
      escapeCSV(alertData.cik || 'N/A'),
      escapeCSV(alertData.ticker || 'N/A'),
      escapeCSV(companyName),
      escapeCSV(alertData.price || 'N/A'),
      escapeCSV(incorporated || 'N/A'),
      escapeCSV(located || 'N/A'),
      escapeCSV(alertData.marketCap || 'N/A'),
      escapeCSV(alertData.float || 'N/A'),
      escapeCSV(alertData.sharesOutstanding || 'N/A'),
      escapeCSV(alertData.soRatio || 'N/A'),
      escapeCSV(csvWA !== 'N/A' ? parseFloat(csvWA).toFixed(2) : 'N/A'),
      escapeCSV(csvFAV),
      escapeCSV(alertData.direction || 'N/A'),
      escapeCSV(alertData.ftd || 'false'),
      escapeCSV(alertData.ftdPercent || 'N/A'),
      escapeCSV(alertData.volume || 'N/A'),
      escapeCSV(alertData.averageVolume || 'N/A'),
      escapeCSV(sector),
      escapeCSV(alertData.filingType || 'N/A'),
      escapeCSV(signals || 'Press/Regulatory Release'),
      escapeCSV(alertData.custodianControl ? (alertData.custodianVerified ? `1.3x ${alertData.custodianName}` : alertData.custodianName) : 'No'),
      escapeCSV(alertData.filingTimeBonus ? `${alertData.filingTimeBonus}x Filing Time` : 'No'),
      escapeCSV(alertData.soBonus && alertData.soBonus > 1.0 ? `${alertData.soBonus}x S/O` : 'No'),
      escapeCSV(bonusSignalsStr),
      escapeCSV(financialRatiosStr),
      escapeCSV(alertData.alertType || 'N/A'),
      escapeCSV(alertData.skipReason || ''),
      escapeCSV(filedDate),
      escapeCSV(filedTime),
      escapeCSV(scannedDate),
      escapeCSV(scannedTime),
    ];

    // Convert to CSV string
    const csvRow = row.join(',') + '\n';
    fs.appendFileSync(csvPath, csvRow);
  } catch (err) {
    log('WARN', `CSV save failed: ${err.message}`);
  }
};

const saveAlert = (alertData) => {
  try {
    // saveAlert called
    let alerts = [];
    if (fs.existsSync(CONFIG.ALERTS_FILE)) {
      const content = fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8').trim();
      if (content) {
        try {
          alerts = JSON.parse(content);
          if (!Array.isArray(alerts)) alerts = [];
        } catch (e) {
          console.log('DEBUG: Failed to parse alerts.json:', e.message);
          alerts = [];
        }
      }
    }
    
    // Determine direction - use isShort flag from alertData
    const direction = alertData.isShort ? 'SHORT' : 'LONG';
    
    const enrichedData = {
      ...alertData,
      recordedAt: new Date().toISOString(),
      recordId: `${alertData.ticker}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      direction: direction,
      // Initialize correct fields based on position type
      // SHORT positions track lowest price/percentage, LONG tracks highest
      highest5Day: !alertData.isShort ? (alertData.price || 0) : 0,
      highest5DayPercent: 0,
      lowest5Day: alertData.isShort ? (alertData.price || 0) : 0,
      lowest5DayPercent: 0,
      isShort: alertData.isShort
    };
    
    const reason = (alertData.intent && Array.isArray(alertData.intent)) 
      ? alertData.intent.join('; ')
      : (alertData.intent ? String(alertData.intent) : 'Filing');
    
    // Update alert data with skip reason showing it was alerted
    const bonusItems = [];
    if (alertData.hasTuesdayBonus) bonusItems.push('Tuesday 1.2x');
    if (alertData.custodianControl) {
      const custodianLabel = alertData.custodianVerified ? `${alertData.custodianName} 1.3x` : `${alertData.custodianName} 1.15x`;
      bonusItems.push(custodianLabel);
    }
    if (alertData.filingTimeBonus) bonusItems.push(`Filing Time ${alertData.filingTimeBonus}x`);
    if (alertData.soBonus && alertData.soBonus > 1.0) bonusItems.push(`S/O ${alertData.soBonus}x`);
    if (alertData.bonusSignals) {
      if (alertData.bonusSignals['DTC Chill Lift']) bonusItems.push('DTC Chill Lift');
      if (alertData.bonusSignals['Shell Recycling']) bonusItems.push('Shell Recycling');
      if (alertData.bonusSignals['VStock']) bonusItems.push('Transfer Agent Change');
      if (alertData.bonusSignals['NT 10K'] === 'NT 10K Filed') bonusItems.push('Late Filing Notice');
      if (alertData.bonusSignals['NT 10K'] === 'Actual 10K Filed') bonusItems.push('10-K Filing');
      if (alertData.bonusSignals['Third Party'] && Array.isArray(alertData.bonusSignals['Third Party'])) {
        bonusItems.push(`Services: ${alertData.bonusSignals['Third Party'].join(', ')}`);
      }
    }
    // Add financial ratio signals to log output if detected
    let financialRatioIndicator = '';
    if (alertData.financialRatioSignals && alertData.financialRatioSignals.signals && alertData.financialRatioSignals.signals.length > 0) {
      const ratioLabels = alertData.financialRatioSignals.signals.map(s => s.split('(')[0].trim()).join(' + ');
      const severityLevel = alertData.financialRatioSignals.severity > 0.85 ? 'Critical' : 'Elevated';
      financialRatioIndicator = ` (Financial Ratios - ${severityLevel}: ${ratioLabels})`;
    }
    const bonusIndicator = bonusItems.length > 0 ? ` (Bonus: ${bonusItems.join(' + ')})` : '';
    const deterministicIndicator = alertData.deterministicPhrase ? ` ${alertData.deterministicPhrase}` : '';
    alertData.skipReason = `Alert sent: [${direction}] ${reason}${financialRatioIndicator}${bonusIndicator}${deterministicIndicator}`;
    
    // Save to CSV for analysis (non-blocking)
    setImmediate(() => saveToCSV(alertData));
    
    // Cleanup stale alerts based on day of week (non-blocking)
    setImmediate(() => cleanupStaleAlerts());
    
    // NOW save to JSON files (already passed time window check above)
    if (Object.keys(alertData.signals || {}).length > 0) {
      let stocks = [];
      if (fs.existsSync(CONFIG.STOCKS_FILE)) {
        const content = fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8').trim();
        if (content) {
          try {
            stocks = JSON.parse(content);
            if (!Array.isArray(stocks)) stocks = [];
          } catch (e) {
            stocks = [];
          }
        }
      }
      stocks.push(enrichedData);
      if (stocks.length > 5000) stocks = stocks.slice(-5000);
      try {
        fs.writeFileSync(CONFIG.STOCKS_FILE, JSON.stringify(stocks, null, 2));
        log('INFO', `Saved to ${CONFIG.STOCKS_FILE}: ${alertData.ticker}`);
      } catch (writeErr) {
        log('ERR', `Failed to write ${CONFIG.STOCKS_FILE}: ${writeErr.message}`);
      }
    }
    
    alerts.push(enrichedData);
    if (alerts.length > 1000) alerts = alerts.slice(-1000);
    // writing alerts.json
    try {
      fs.writeFileSync(CONFIG.ALERTS_FILE, JSON.stringify(alerts, null, 2));
    } catch (writeErr) {
      console.log('DEBUG: Error writing alerts.json:', writeErr.message);
      log('ERR', `Failed to write alerts.json: ${writeErr.message}`);
      console.error('writeErr:', writeErr);
      return; // STOP - don't send webhooks if JSON save failed
    }
    
    // Add direction to alertData before sending webhooks
    alertData.direction = direction;
    
    // Only send webhooks if JSON save succeeded
    sendPersonalWebhook(alertData);
    setTimeout(() => sendPaidWebhook(alertData), 10000);
    setTimeout(() => sendTelegramAlert(alertData), 10000);
    
    // Log the TradingView and SEC links for the alert
    const ticker = alertData.ticker;
    const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
    const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${alertData.cik}&type=6-K&dateb=&owner=exclude&count=100`;
    log('INFO', `Links: ${tvLink} ${secLink}`);
    
    // Consolidated single log line for all file saves + git status
    const gitStatus = CONFIG.GITHUB_PUSH_ENABLED && CONFIG.GITHUB_PAGES_ENABLED ? 'Git Push Enabled' : 'Git Push Disabled';
    log('INFO', `Alert Saved: ${alertData.ticker} to stocks.json, alert.json and quote.json | ${gitStatus}`);
    console.log('');
    
    // Update performance tracking data for HTML dashboard (non-blocking)
    setImmediate(() => updatePerformanceData(alertData));
    
    try {
      if (fs.existsSync(CONFIG.ALERTS_FILE)) {
        const savedAlerts = JSON.parse(fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8'));
        const lastAlert = savedAlerts[savedAlerts.length - 1];
        if (lastAlert && lastAlert.recordId === enrichedData.recordId) {
          // Alert saved successfully
        }
      }
    } catch (verifyErr) {
      // Verification failed silently
    }
  } catch (err) {
    log('ERROR', `Failed to save alert: ${err.message}`);
  }
  
  pushToGitHub();
};

// Update performance tracking data for alerts (for HTML dashboard)
const updatePerformanceData = (alertData) => {
  try {
    let performanceData = {};
    
    // Load existing performance data
    if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
      try {
        const content = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
        if (content && content.length > 0) {
          performanceData = JSON.parse(content);
          if (!performanceData || typeof performanceData !== 'object') {
            performanceData = {};
          }
        }
      } catch (e) {
        // If file is corrupted or being written, start fresh
        performanceData = {};
      }
    }
    
    const ticker = alertData.ticker;
    const currentPrice = parseFloat(alertData.price) || 0;
    
    // Initialize or update ticker performance data
    if (!performanceData[ticker]) {
      performanceData[ticker] = {
        short: alertData.isShort ? true : false,
        alert: currentPrice,
        highest: currentPrice,
        lowest: currentPrice,
        highest5Day: currentPrice,
        lowest5Day: currentPrice,
        highest5DayPercent: 0,
        lowest5DayPercent: 0,
        current: currentPrice,
        currentPrice: currentPrice,
        performance: 0,
        date: new Date().toISOString(),
        alertDate: new Date().toISOString(),
        reverseSplitRatio: null
      };
    } else {
      // Update current price and track peaks/lows
      performanceData[ticker].short = alertData.isShort ? true : false;
      performanceData[ticker].current = currentPrice;
      if (currentPrice > performanceData[ticker].highest) {
        performanceData[ticker].highest = currentPrice;
      }
      if (currentPrice < performanceData[ticker].lowest) {
        performanceData[ticker].lowest = currentPrice;
      }
      
      // Track 5-day peak AND trough (reset daily)
      const alertDate = new Date(performanceData[ticker].alertDate);
      const now = new Date();
      const daysDiff = Math.floor((now - alertDate) / (1000 * 60 * 60 * 24));
      
      const isShort = alertData.isShort === true;
      const alertPrice = performanceData[ticker].alert || 0;
      
      if (daysDiff <= 5) {
        // Track highest price
        if (currentPrice > performanceData[ticker].highest5Day) {
          performanceData[ticker].highest5Day = currentPrice;
          if (alertPrice > 0) {
            let highPercent = currentPrice - alertPrice;
            if (isShort) {
              highPercent = -highPercent;
            }
            performanceData[ticker].highest5DayPercent = parseFloat((highPercent / alertPrice * 100).toFixed(2));
          }
        }
        
        // Track lowest price
        if (currentPrice < performanceData[ticker].lowest5Day) {
          performanceData[ticker].lowest5Day = currentPrice;
          if (alertPrice > 0) {
            let lowPercent = currentPrice - alertPrice;
            if (isShort) {
              lowPercent = -lowPercent;
            }
            performanceData[ticker].lowest5DayPercent = parseFloat((lowPercent / alertPrice * 100).toFixed(2));
          }
        }
      } else {
        // Reset 5-day peak/trough after 5 days
        performanceData[ticker].highest5Day = currentPrice;
        performanceData[ticker].lowest5Day = currentPrice;
        performanceData[ticker].highest5DayPercent = 0;
        performanceData[ticker].lowest5DayPercent = 0;
      }
    }
    
    // Calculate performance metrics
    const alertPrice = performanceData[ticker].alert || 0;
    if (alertPrice > 0) {
      const change = currentPrice - alertPrice;
      let percentChange = (change / alertPrice) * 100;
      
      // For SHORT positions: invert the sign (price up = loss, price down = profit)
      if (alertData.isShort === true) {
        percentChange = -percentChange;
      }
      
      performanceData[ticker].performance = parseFloat(percentChange.toFixed(2));
      performanceData[ticker].reverseSplitRatio = null; // Can be updated if needed
    }
    
    // Write updated performance data (atomic write)
    try {
      const tempFile = CONFIG.PERFORMANCE_FILE + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(performanceData, null, 2));
      fs.renameSync(tempFile, CONFIG.PERFORMANCE_FILE);
    } catch (err) {
      // Fall back to direct write if atomic fails
      fs.writeFileSync(CONFIG.PERFORMANCE_FILE, JSON.stringify(performanceData, null, 2));
    }
    
    // Auto-push quotes to GitHub if enabled
    if (CONFIG.GITHUB_QUOTE_PUSH_ENABLED) {
      pushToGitHub();
    }
    
    // Sync peak data back to stocks.json
    syncPeakDataToStocks(ticker, performanceData[ticker]);
    
  } catch (err) {
    log('WARN', `Failed to update performance data: ${err.message}`);
  }
};

// Sync peak price and % change to stocks.json for history display
const syncPeakDataToStocks = (ticker, peakData) => {
  try {
    if (!fs.existsSync(CONFIG.STOCKS_FILE)) return;
    
    const content = fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8').trim();
    if (!content) return;
    
    let stocks = JSON.parse(content);
    if (!Array.isArray(stocks)) return;
    
    // Get highest/lowest and current price from quote.json first (live data)
    let highestPrice = peakData.highest5Day;
    let lowestPrice = peakData.lowest5Day;
    let currentPrice = peakData.current;
    
    if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
      try {
        const quoteContent = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
        if (quoteContent) {
          const quotes = JSON.parse(quoteContent);
          if (quotes[ticker]) {
            // Use live prices from quote.json
            highestPrice = quotes[ticker].highest || quotes[ticker].high || highestPrice;
            lowestPrice = quotes[ticker].lowest || quotes[ticker].low || lowestPrice;
            currentPrice = quotes[ticker].current || quotes[ticker].currentPrice || currentPrice;
          }
        }
      } catch (e) {
        // Fall back to peakData
      }
    }
    
    // Find and update matching ticker entries in stocks.json
    stocks = stocks.map(stock => {
      if (stock.ticker === ticker) {
        const alertPrice = stock.price || 0;
        const isShort = stock.direction === 'SHORT' || stock.isShort === true;
        
        let highestPercent = 0, lowestPercent = 0;
        
        if (isShort) {
          // SHORT: lowest price = profit, highest price = loss
          if (alertPrice > 0) {
            lowestPercent = parseFloat((((alertPrice - lowestPrice) / alertPrice) * 100).toFixed(2)); // profit when price down
            highestPercent = parseFloat((((highestPrice - alertPrice) / alertPrice) * 100).toFixed(2)); // loss when price up
          }
          return {
            ...stock,
            highest5Day: highestPrice,
            highest5DayPercent: highestPercent,
            lowest5Day: lowestPrice,
            lowest5DayPercent: lowestPercent,
            isShort: true
          };
        } else {
          // LONG: highest price = profit, lowest price = loss
          if (alertPrice > 0) {
            highestPercent = parseFloat((((highestPrice - alertPrice) / alertPrice) * 100).toFixed(2)); // profit when price up
            lowestPercent = parseFloat((((lowestPrice - alertPrice) / alertPrice) * 100).toFixed(2)); // loss when price down
          }
          return {
            ...stock,
            highest5Day: highestPrice,
            highest5DayPercent: highestPercent,
            lowest5Day: lowestPrice,
            lowest5DayPercent: lowestPercent,
            isShort: false
          };
        }
      }
      return stock;
    });
    
    fs.writeFileSync(CONFIG.STOCKS_FILE, JSON.stringify(stocks, null, 2));
  } catch (err) {
    // Silent fail - don't spam logs for this background sync
  }
};

// Periodically sync all stocks with current prices from quote.json
const syncAllPeakData = () => {
  try {
    if (!fs.existsSync(CONFIG.STOCKS_FILE) || !fs.existsSync(CONFIG.PERFORMANCE_FILE)) return;
    
    const stocksContent = fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8').trim();
    const quotesContent = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
    
    if (!stocksContent || !quotesContent) return;
    
    let stocks = JSON.parse(stocksContent);
    const quotes = JSON.parse(quotesContent);
    
    if (!Array.isArray(stocks) || typeof quotes !== 'object') return;
    
    // Update each stock with current price and peak data from quote.json
    stocks = stocks.map(stock => {
      if (quotes[stock.ticker]) {
        const quoteData = quotes[stock.ticker];
        const alertPrice = stock.price || 0;
        const currentPrice = quoteData.current || quoteData.currentPrice || stock.price;
        const isShort = stock.direction === 'SHORT' || stock.isShort === true;
        const highestPrice = quoteData.highest || currentPrice;
        const lowestPrice = quoteData.lowest || currentPrice;
        
        if (isShort) {
          // SHORT: lowest price = profit, highest price = loss
          let lowestPercent = 0;
          let highestPercent = 0;
          if (alertPrice > 0) {
            lowestPercent = parseFloat((((alertPrice - lowestPrice) / alertPrice) * 100).toFixed(2)); // profit
            highestPercent = parseFloat((((highestPrice - alertPrice) / alertPrice) * 100).toFixed(2)); // loss
          }
          return {
            ...stock,
            highest5Day: highestPrice,
            highest5DayPercent: highestPercent,
            lowest5Day: lowestPrice,
            lowest5DayPercent: lowestPercent,
            isShort: true
          };
        } else {
          // LONG: show the most extreme move (biggest profit OR biggest loss)
          let highestPercent = 0;
          let lowestPercent = 0;
          if (alertPrice > 0) {
            highestPercent = parseFloat((((highestPrice - alertPrice) / alertPrice) * 100).toFixed(2)); // profit
            lowestPercent = parseFloat((((lowestPrice - alertPrice) / alertPrice) * 100).toFixed(2)); // loss
          }
          
          // Store both, but use the more extreme move for display
          return {
            ...stock,
            highest5Day: highestPrice,
            highest5DayPercent: highestPercent,
            lowest5Day: lowestPrice,
            lowest5DayPercent: lowestPercent,
            isShort: false
          };
        }
      }
      return stock;
    });
    
    fs.writeFileSync(CONFIG.STOCKS_FILE, JSON.stringify(stocks, null, 2));
    
    // Also update quote.json with the most extreme move (best profit or worst loss)
    try {
      let updatedQuotes = quotes;
      stocks.forEach(stock => {
        if (updatedQuotes[stock.ticker]) {
          const highestPercent = Math.abs(stock.highest5DayPercent || 0);
          const lowestPercent = Math.abs(stock.lowest5DayPercent || 0);
          
          // Write the more extreme move to 'highest' field so history tab displays it
          if (lowestPercent > highestPercent) {
            updatedQuotes[stock.ticker].highest = stock.lowest5Day;
          } else {
            updatedQuotes[stock.ticker].highest = stock.highest5Day;
          }
          updatedQuotes[stock.ticker].lowest = stock.lowest5Day;
        }
      });
      fs.writeFileSync(CONFIG.PERFORMANCE_FILE, JSON.stringify(updatedQuotes, null, 2));
    } catch (e) {
      // Silent fail
    }
  } catch (err) {
    // Silent fail
  }
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Fetch with proper timeout using AbortController
const fetchWithTimeout = async (url, timeoutMs = 5000, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
};
// Get FTD (Failed to Deliver) data from docs/ftd.txt - returns SUM of ALL entries
const getFTDData = (ticker) => {
  try {
    if (!fs.existsSync('docs/ftd.txt')) return false;
    const ftdContent = fs.readFileSync('docs/ftd.txt', 'utf8');
    const lines = ftdContent.split('\n');
    let totalFTD = 0;
    
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length >= 4 && parts[2].toUpperCase() === ticker.toUpperCase()) {
        const ftdQty = parseInt(parts[3]) || 0;
        totalFTD += ftdQty; // Sum all FTD entries
      }
    }
    
    return totalFTD > 0 ? totalFTD : false;
  } catch (e) {
    return false;
  }
};

// Fetch sector/industry from Finnhub profile
const getSectorFromFinnhub = async (ticker) => {
  try {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (!finnhubKey) return null;
    
    const res = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${finnhubKey}`, 5000);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (data.finnhubIndustry) {
      return data.finnhubIndustry;
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Fetch float data from Financial Modeling Prep
// Get shares outstanding from Alpha Vantage (primary)
const getSharesFromAlphaVantage = async (ticker) => {
  try {
    const avKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!avKey) return null;
    
    const res = await fetchWithTimeout(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${avKey}`, 5000);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (data.SharesOutstanding && data.SharesOutstanding !== 'None') {
      return Math.round(parseInt(data.SharesOutstanding) || 0) || null;
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Get shares outstanding from Finnhub (secondary)
const getSharesFromFinnhub = async (ticker) => {
  try {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (!finnhubKey) return null;
    
    const res = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${finnhubKey}`, 5000);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (data.shareOutstanding && data.shareOutstanding > 0) {
      return Math.round(data.shareOutstanding);
    }
    return null;
  } catch (e) {
    return null;
  }
};

// Get shares outstanding with priority: Alpha Vantage → Finnhub → FMP
const getSharesOutstanding = async (ticker) => {
  // Try Finnhub first (most reliable)
  try {
    const finnhubKey = process.env.FINNHUB_API_KEY;
    if (finnhubKey) {
      const res = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${finnhubKey}`, 8000);
      if (res.ok) {
        const data = await res.json();
        if (data.shareOutstanding && data.shareOutstanding > 0) {
          return Math.round(data.shareOutstanding);
        }
      }
    }
  } catch (e) {}
  
  // Fallback to FMP shares-float endpoint which has outstandingShares
  try {
    const fmpKey = process.env.FMP_API_KEY;
    if (!fmpKey) return 'N/A';
    
    const res = await fetchWithTimeout(`https://financialmodelingprep.com/stable/shares-float?symbol=${ticker}&apikey=${fmpKey}`, 8000);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data[0] && data[0].outstandingShares) {
        const shares = Math.round(data[0].outstandingShares);
        if (shares > 0) return shares;
      }
    }
  } catch (e) {}
  
  return 'N/A';
};

// Extract float shares from SEC filing text (10-K, 10-Q, 6-K, 8-K)
const extractFloatFromFiling = (text, sharesOutstanding) => {
  if (!text) return null;
  
  // Remove HTML tags and normalize whitespace
  let cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  
  // Debug: log text size
  if (cleanText.length < 100) {
    return null; // Text too short to contain shares data
  }
  
  // Pattern 1: "outstanding shares of common stock as of [date]: [number]"
  let match = cleanText.match(/outstanding shares of (?:common )?stock as of [^:]*:\s*([0-9,]+)/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 0) return shares;
  }
  
  // Pattern 2: "indicate the number of shares outstanding of each class: [number]"
  match = cleanText.match(/indicate the number of shares outstanding[^0-9]*?([0-9]{6,})/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 1000) return shares; // At least 1000 shares to be valid
  }
  
  // Pattern 3: "class [A-Z] common stock.*[number] shares outstanding"
  match = cleanText.match(/(?:class [a-z]+ )?common stock[^0-9]*?([0-9,]+)\s+shares? outstanding/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 1000) return shares;
  }
  
  // Pattern 4: "shares outstanding" followed by number (flexible spacing)
  match = cleanText.match(/shares? outstanding[:\s]*([0-9,]+)/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 1000) return shares;
  }
  
  // Pattern 5: "Number of shares outstanding" (common in 6-K)
  match = cleanText.match(/number of shares outstanding[:\s]*([0-9,]+)/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 1000) return shares;
  }
  
  // Pattern 6: Look for cover page format: "as of [date]" followed by number (often first large number in text)
  match = cleanText.match(/as of\s+[^0-9]*([0-9]{1,2},\d{3},\d{3}|\d{9,})/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 1000) return shares;
  }
  
  // Pattern 7: Look for Form cover page shares outstanding (usually in first 2000 chars)
  const firstPart = cleanText.substring(0, 3000);
  match = firstPart.match(/([0-9]{1,2},\d{3},\d{3}(?:,\d{3})?)\s+(?:shares|common stock outstanding|issued and outstanding)/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 1000) return shares;
  }
  
  // Pattern 8: Just look for "shares" or "outstanding" with a large number anywhere
  match = cleanText.match(/([0-9]{1,2},\d{3},\d{3}(?:,\d{3})?)\s+(?:shares?|common)/i);
  if (match) {
    const shares = parseInt(match[1].replace(/,/g, ''));
    if (shares > 100000) return shares; // Higher threshold for non-specific pattern
  }
  
  // Pattern 9: Cover page indicator number format (X,XXX,XXX)
  const coverPageMatch = firstPart.match(/\b([0-9]{1,3},\d{3},\d{3})\b/);
  if (coverPageMatch) {
    const shares = parseInt(coverPageMatch[1].replace(/,/g, ''));
    if (shares > 1000000) return shares; // Very high threshold for generic number
  }
  
  return null;
};

// Get float data from Alpha Vantage first, then Polygon, then FMP as fallback
// Get float data from Alpha Vantage first, then FMP as fallback
const getFloatData = async (ticker) => {
  // Try Alpha Vantage first (has both SharesFloat and SharesOutstanding)
  try {
    const avKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (avKey) {
      const res = await fetchWithTimeout(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${ticker}&apikey=${avKey}`, 8000);
      if (res.ok) {
        const data = await res.json();
        if (data.SharesFloat && data.SharesFloat !== 'None') {
          const float = Math.round(parseInt(data.SharesFloat) || 0);
          if (float > 0) return float;
        }
      }
    }
  } catch (e) {}
  
  // Fallback to FMP - this endpoint has both float and shares outstanding
  try {
    const fmpKey = process.env.FMP_API_KEY;
    if (!fmpKey) return 'N/A';
    
    const url = `https://financialmodelingprep.com/stable/shares-float?symbol=${ticker}&apikey=${fmpKey}`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return 'N/A';
    
    const data = await res.json();
    if (Array.isArray(data) && data[0] && data[0].floatShares) {
      const float = Math.round(data[0].floatShares);
      if (float > 0) return float;
    }
    
    // If floatShares not available but outstandingShares is, use that as fallback
    if (Array.isArray(data) && data[0] && data[0].outstandingShares) {
      const shares = Math.round(data[0].outstandingShares);
      if (shares > 0) return shares;
    }
    
    return 'N/A';
  } catch (e) {
    return 'N/A';
  }
};

// Fetch quote data - only used as fallback when Yahoo/Finnhub fail
const getFMPQuote = async (ticker) => {
  try {
    const fmpKey = process.env.FMP_API_KEY;
    if (!fmpKey) return null;
    
    const res = await fetchWithTimeout(`https://financialmodelingprep.com/stable/shares-float?symbol=${ticker}&apikey=${fmpKey}`, 5000);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;
    
    const d = data[0];
    
    return {
      regularMarketPrice: 'N/A', // FMP shares-float doesn't have price
      regularMarketVolume: 0,
      marketCap: 'N/A',
      sharesOutstanding: d.outstandingShares ? Math.round(d.outstandingShares) : 'N/A',
      averageDailyVolume3Month: 0,
      floatShares: d.floatShares ? Math.round(d.floatShares) : 'N/A'
    };
  } catch (e) {
    return null;
  }
};

async function fetchFilings() {
  const allFilings = [];
  
  try {
    await wait(200);
    const res = await fetchWithTimeout('https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=6-K&count=100&owner=exclude&output=atom', CONFIG.SEC_FETCH_TIMEOUT || 10000, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
      }
    });
    if (res.ok) {
      const xml = await res.text();
      const entries = xml.split('<entry>').slice(1);
      for (const entry of entries) {
        const title = entry.match(/<title[^>]*>(.*?)<\/title>/s)?.[1];
        const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
        const updated = entry.match(/<updated[^>]*>(.*?)<\/updated>/)?.[1];
        if (!title || !link || !updated) continue;
        const ageMin = (Date.now() - new Date(updated).getTime()) / (1000 * 60);
        if (ageMin > CONFIG.FILE_TIME) continue; // Only recent filings (1 minute)
        const cik = link.match(/\/data\/(\d+)\//)?.[1];
        allFilings.push({ txtLink: link, title, cik, updated, source: 'SEC', formType: '6-K' });
      }
    }
    await rateLimit.wait();
  } catch (err) {
    // Silently fail - suppress all SEC fetch warnings
  }

  allFilings.sort((a, b) => new Date(b.updated) - new Date(a.updated));
  return allFilings.slice(0, 100);
}

const isValidTicker = ticker => {
  if (!ticker || ticker.length < 1 || ticker.length > 5) return false;
  return /^[A-Z]+$/.test(ticker);
};

async function getCountryAndTicker(cik) {
  const stateCountryFallback = {
    'DE': 'Delaware', 'CA': 'California', 'NY': 'New York', 'TX': 'Texas', 'FL': 'Florida',
    'WA': 'Washington', 'IL': 'Illinois', 'PA': 'Pennsylvania', 'OH': 'Ohio', 'GA': 'Georgia',
    'MI': 'Michigan', 'NC': 'North Carolina', 'NJ': 'New Jersey', 'VA': 'Virginia', 'MA': 'Massachusetts',
    'AZ': 'Arizona', 'TN': 'Tennessee', 'IN': 'Indiana', 'MD': 'Maryland', 'CO': 'Colorado',
    'MN': 'Minnesota', 'MO': 'Missouri', 'WI': 'Wisconsin', 'UT': 'Utah', 'NV': 'Nevada',
    'NM': 'New Mexico', 'CT': 'Connecticut', 'OK': 'Oklahoma', 'IA': 'Iowa', 'OR': 'Oregon',
    'KS': 'Kansas', 'AR': 'Arkansas', 'MS': 'Mississippi', 'LA': 'Louisiana', 'KY': 'Kentucky',
    'SC': 'South Carolina', 'AL': 'Alabama', 'WV': 'West Virginia', 'NE': 'Nebraska', 'ID': 'Idaho',
    'HI': 'Hawaii', 'AK': 'Alaska', 'VT': 'Vermont', 'ME': 'Maine', 'MT': 'Montana',
    'RI': 'Rhode Island', 'NH': 'New Hampshire', 'WY': 'Wyoming', 'ND': 'North Dakota', 'SD': 'South Dakota',
    'DC': 'District of Columbia', 'PR': 'Puerto Rico', 'VI': 'U.S. Virgin Islands', 'GU': 'Guam',
    'AS': 'American Samoa', 'MP': 'Northern Mariana Islands',
    'CN': 'China', 'HK': 'Hong Kong', 'SG': 'Singapore', 'IL': 'Israel', 'JP': 'Japan',
    'IE': 'Ireland', 'KY': 'Cayman Islands', 'VG': 'British Virgin Islands', 'CA': 'Canada',
    'GB': 'United Kingdom', 'CH': 'Switzerland', 'DE': 'Germany', 'FR': 'France', 'BR': 'Brazil',
    'A8': 'Montreal, Canada'
  };
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const padded = cik.toString().padStart(10, '0');
      await wait(500);
      const res = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${padded}.json`, CONFIG.SEC_FETCH_TIMEOUT, {
        headers: {
          'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
          'Accept': 'application/json'
        }
      });
      if (res.status === 403) {
        await wait(2000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      let incorporated = '';
      let located = '';

      if (data.stateOfIncorporation) {
        incorporated = data.stateOfIncorporation;
      } else if (data.incorporated && data.incorporated.stateOrCountry) {
        incorporated = data.incorporated.stateOrCountry;
      } else if (data.incorporated && data.incorporated.country) {
        incorporated = data.incorporated.country;
      }

      if (data.addresses && data.addresses.business && data.addresses.business.stateOrCountry) {
        located = data.addresses.business.stateOrCountry;
      } else if (data.addresses && data.addresses.business && data.addresses.business.country) {
        located = data.addresses.business.country;
      } else if (data.addresses && data.addresses.mailing && data.addresses.mailing.stateOrCountry) {
        located = data.addresses.mailing.stateOrCountry;
      } else if (data.addresses && data.addresses.mailing && data.addresses.mailing.country) {
        located = data.addresses.mailing.country;
      }

      if (!incorporated && data.entityType && /^[A-Z]{2}$/.test(data.entityType)) {
        incorporated = data.entityType;
      }

      let incorporatedDisplay = 'Unknown';
      let locatedDisplay = 'Unknown';
      
      if (incorporated) {
        incorporatedDisplay = SEC_CODE_TO_COUNTRY[incorporated] || stateCountryFallback[incorporated] || incorporated;
      }
      if (located) {
        locatedDisplay = SEC_CODE_TO_COUNTRY[located] || stateCountryFallback[located] || located;
      }

      return {
        incorporated: incorporatedDisplay,
        located: locatedDisplay,
        ticker: data.tickers?.[0] || 'Unknown',
        companyName: data.name || data.entityName || data.conformed_name || 'Unknown',
        cikNumber: data.cik_str || data.cik || cik
      };
    } catch (err) {
      log('WARN', `SEC lookup attempt ${attempt} failed for CIK ${cik}: ${err.message}`);
      if (attempt < 3) await wait(5000);
    }
  }
  return { incorporated: 'Unknown', located: 'Unknown', ticker: 'Unknown' };
}

async function fetch8Ks() {
  const filings8K = [];
  try {
    await wait(200);
    const res = await fetchWithTimeout('https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=100&owner=exclude&output=atom', 15000, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (res.ok) {
      const xml = await res.text();
      const entries = xml.split('<entry>').slice(1);
      for (const entry of entries) {
        const title = entry.match(/<title[^>]*>(.*?)<\/title>/s)?.[1];
        const link = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
        const updated = entry.match(/<updated[^>]*>(.*?)<\/updated>/)?.[1];
        if (!title || !link || !updated) continue;
        const ageMin = (Date.now() - new Date(updated).getTime()) / (1000 * 60);
        if (ageMin > CONFIG.FILE_TIME) continue;
        const cik = link.match(/\/data\/(\d+)\//)?.[1];
        filings8K.push({ txtLink: link, title, cik, updated, source: 'SEC', formType: '8-K' });
      }
    }
    await rateLimit.wait();
  } catch (err) {
    // Silently fail - suppress all SEC fetch warnings
  }
  return filings8K;
}

async function getFilingText(indexUrl) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      await wait(100); // Minimal delay, rate limiter handles the rest
      const res = await Promise.race([
        fetch(indexUrl, {
          headers: {
            'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
          }
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SEC index fetch timeout')), CONFIG.SEC_FETCH_TIMEOUT))
      ]);

      if (res.status === 403) {
        log('WARN', `SEC blocked request (403), waiting 5 seconds`);
        await wait(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      
      const html = await Promise.race([
        res.text(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SEC index text parse timeout')), CONFIG.SEC_FETCH_TIMEOUT))
      ]);
      
      const docHrefs = [];
      
      // Simple non-backtracking regex to extract links
      const hrefMatches = html.match(/href="([^"]+)"/g) || [];
      for (const hrefMatch of hrefMatches) {
        const href = hrefMatch.replace(/^href="/, '').replace(/"$/, '');
        const lower = href.toLowerCase();
        if ((lower.endsWith('.txt') || lower.endsWith('.html') || lower.endsWith('.htm')) && !lower.includes('index')) {
          docHrefs.push(href);
        }
      }
      
      // If no documents found, try a more permissive search
      if (docHrefs.length === 0) {
        const allLinks = html.match(/href="([^"]+\.(?:txt|html|htm))"/gi) || [];
        for (const link of allLinks) {
          const href = link.replace(/^href="/, '').replace(/"$/i, '');
          const lower = href.toLowerCase();
          if (!lower.includes('index') && !lower.includes('style')) {
            docHrefs.push(href);
          }
        }
      }
      
      const txtFiles = docHrefs.filter(href => href.toLowerCase().endsWith('.txt'));
      const htmlFiles = docHrefs.filter(href => !href.toLowerCase().endsWith('.txt'));
      
      const prioritizedHrefs = txtFiles.length > 0 ? txtFiles : htmlFiles;
      if (prioritizedHrefs.length === 0) throw new Error(`No filing documents found at ${indexUrl}`);
      
      let combinedText = '';
      const MAX_COMBINED_SIZE = CONFIG.MAX_COMBINED_SIZE;
      
      for (const href of prioritizedHrefs.slice(0, 2)) {
        const fullUrl = href.startsWith('http') ? href : `https://www.sec.gov${href}`;        
        
        try {
          const docRes = await Promise.race([
            fetch(fullUrl, {
              headers: {
                'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
              }
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SEC document fetch timeout')), CONFIG.SEC_FETCH_TIMEOUT))
          ]);

          let docText = await Promise.race([
            docRes.text(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('SEC document text parse timeout')), CONFIG.SEC_FETCH_TIMEOUT))
          ]);
          
          const lowerText = docText.toLowerCase();
          if ((lowerText.includes('sec.gov') && lowerText.includes('search filings')) ||
              lowerText.includes('sec home') || 
              lowerText.includes('filing detail') ||
              lowerText.includes('edgar latest filings') ||
              (lowerText.includes('<table') && lowerText.includes('column heading') && lowerText.length < 5000)) {
            continue; // Skip navigation/index pages
          }
          
          if (docText.length > 500000) {
            docText = docText.slice(0, 500000);
          }
          
          let cleanText = docText
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(parseInt(code)))
            .replace(/<[^>]+>/g, ' ')
            .replace(/\d{10}-\d{2}-\d{6}\.\w+\s*:\s*\d+\s*\d{10}-\d{2}-\d{6}\.\w+/g, '')
            .replace(/^\s*(?:exhibit|annex|appendix|schedule|form|section)\s+[a-z0-9]+\s*\n/gim, '')
            .replace(/(?:table of contents|index to exhibits|signatures|certification|forward-looking statements|risk factors)/gi, '')
            .replace(/(?:page \d+|continued|see page|see exhibit|see schedule)/gi, '')
            .replace(/filed\s+(?:on\s+)?[\d\-\/]*/gi, '')
            .replace(/(?:sec\.?gov|edgar|securities and exchange|s\.e\.c\.|rule \d+-\d+)/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
          
          combinedText += cleanText + ' ';
          
          docText = null;
          cleanText = null;
          
          await rateLimit.wait();
          
          if (combinedText.length > MAX_COMBINED_SIZE) break;
        } catch (docErr) {
          log('DEBUG', `Document fetch error for ${fullUrl}: ${docErr.message}`);
          continue;
        }
      }
      
      combinedText = combinedText
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, MAX_COMBINED_SIZE);
      
      return combinedText;
    } catch (err) {
      log('ERROR', `Filing text fetch attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt < 3) await wait(3000);
    }
  }
  log('ERROR', `Failed to fetch filing text after 3 attempts from ${indexUrl}`);
  return '';
}

// Get shares outstanding from SEC 10-K/10-Q XBRL filings
async function getSharesOutstandingFromSEC(cik) {
  try {
    const padded = cik.toString().padStart(10, '0');
    await rateLimit.wait();
    
    const res = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${padded}.json`, CONFIG.SEC_FETCH_TIMEOUT, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'application/json'
      }
    });
    
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    
    // Get the most recent 10-K or 10-Q filing
    const filings = data.filings?.recent?.filings || [];
    const recentTenK = filings.find(f => f.form === '10-K' || f.form === '10-Q');
    
    if (!recentTenK) {
      log('WARN', `No recent 10-K/10-Q found for CIK ${cik}`);
      return null;
    }
    
    // Fetch the XBRL data for this filing
    const accessionNumber = recentTenK.accession_number?.replace(/-/g, '') || '';
    const xbrlUrl = `https://www.sec.gov/Archives/edgar/${padded}/${accessionNumber}/${accessionNumber}-index.json`;
    
    await rateLimit.wait();
    const xbrlRes = await fetchWithTimeout(xbrlUrl, CONFIG.SEC_FETCH_TIMEOUT, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'application/json'
      }
    });
    
    if (!xbrlRes.ok) throw new Error(`XBRL fetch failed: ${xbrlRes.status}`);
    const xbrlData = await xbrlRes.json();
    
    // Find the XBRL file
    const xbrlFile = xbrlData.files?.find(f => f.name?.endsWith('_htm.xml'));
    if (!xbrlFile) {
      log('WARN', `No XBRL file found for CIK ${cik}`);
      return null;
    }
    
    const xmlUrl = `https://www.sec.gov/Archives/edgar/${padded}/${accessionNumber}/${xbrlFile.name}`;
    await rateLimit.wait();
    
    const xmlRes = await fetchWithTimeout(xmlUrl, CONFIG.SEC_FETCH_TIMEOUT, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'application/xml'
      }
    });
    
    if (!xmlRes.ok) throw new Error(`XML fetch failed: ${xmlRes.status}`);
    const xmlText = await xmlRes.text();
    
    // Extract CommonStockSharesOutstanding from XML
    const match = xmlText.match(/<us-gaap:CommonStockSharesOutstanding[^>]*>(\d+(?:,\d{3})*)<\/us-gaap:CommonStockSharesOutstanding>/);
    
    if (match && match[1]) {
      const sharesOutstanding = parseInt(match[1].replace(/,/g, ''));
      log('INFO', `SEC shares outstanding for CIK ${cik}: ${sharesOutstanding.toLocaleString()}`);
      return sharesOutstanding;
    }
    
    log('WARN', `Could not extract CommonStockSharesOutstanding from XBRL for CIK ${cik}`);
    return null;
  } catch (err) {
    log('WARN', `Failed to fetch shares outstanding from SEC for CIK ${cik}: ${err.message}`);
    return null;
  }
}

// Get float from SEC 10-K/10-Q XBRL filings
async function getFloatFromSEC(cik) {
  try {
    const padded = cik.toString().padStart(10, '0');
    await rateLimit.wait();
    
    // Get the most recent 10-K or 10-Q filing
    const res = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${padded}.json`, CONFIG.SEC_FETCH_TIMEOUT, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'application/json'
      }
    });
    
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    
    const filings = data.filings?.recent?.filings || [];
    const recentTenK = filings.find(f => f.form === '10-K' || f.form === '10-Q');
    
    if (!recentTenK) {
      log('WARN', `No recent 10-K/10-Q found for CIK ${cik} to get float`);
      return null;
    }
    
    // Fetch the XBRL data for this filing
    const accessionNumber = recentTenK.accession_number?.replace(/-/g, '') || '';
    const xbrlUrl = `https://www.sec.gov/Archives/edgar/${padded}/${accessionNumber}/${accessionNumber}-index.json`;
    
    await rateLimit.wait();
    const xbrlRes = await fetchWithTimeout(xbrlUrl, CONFIG.SEC_FETCH_TIMEOUT, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'application/json'
      }
    });
    
    if (!xbrlRes.ok) throw new Error(`XBRL fetch failed: ${xbrlRes.status}`);
    const xbrlData = await xbrlRes.json();
    
    // Find the XBRL file
    const xbrlFile = xbrlData.files?.find(f => f.name?.endsWith('_htm.xml'));
    if (!xbrlFile) {
      log('WARN', `No XBRL file found for CIK ${cik}`);
      return null;
    }
    
    const xmlUrl = `https://www.sec.gov/Archives/edgar/${padded}/${accessionNumber}/${xbrlFile.name}`;
    await rateLimit.wait();
    
    const xmlRes = await fetchWithTimeout(xmlUrl, CONFIG.SEC_FETCH_TIMEOUT, {
      headers: {
        'User-Agent': 'SEC-Bot/1.0 (sendmebsvv@outlook.com)',
        'Accept': 'application/xml'
      }
    });
    
    if (!xmlRes.ok) throw new Error(`XML fetch failed: ${xmlRes.status}`);
    const xmlText = await xmlRes.text();
    
    // Try PublicFloat tag (most direct float from SEC 10-K)
    let floatMatch = xmlText.match(/<us-gaap:PublicFloat[^>]*>(\d+(?:,\d{3})*)<\/us-gaap:PublicFloat>/);
    
    if (floatMatch && floatMatch[1]) {
      const publicFloat = parseInt(floatMatch[1].replace(/,/g, ''));
      log('INFO', `SEC public float for CIK ${cik}: ${publicFloat.toLocaleString()}`);
      return publicFloat;
    }
    
    log('WARN', `Could not extract float from XBRL for CIK ${cik}`);
    return null;
  } catch (err) {
    log('WARN', `Failed to fetch float from SEC for CIK ${cik}: ${err.message}`);
    return null;
  }
}

// Get ownership metrics from SEC, fallback to FMP
async function getOwnershipMetrics(ticker, cik) {
  try {
    log('DEBUG', `Fetching ownership metrics for ${ticker} (CIK ${cik})`);
    
    // Try SEC first for shares outstanding (free, no rate limit issues)
    const sharesOutstanding = await getSharesOutstandingFromSEC(cik);
    
    if (!sharesOutstanding) {
      // Fallback to FMP for both shares outstanding and float
      log('INFO', `SEC lookup failed for ${ticker}, falling back to FMP`);
      const fmpKey = process.env.FMP_API_KEY || 'demo';
      const fmpRes = await fetchWithTimeout(`https://financialmodelingprep.com/api/v4/shares-float?symbol=${ticker}&apikey=${fmpKey}`, 10000);
      
      if (fmpRes.ok) {
        const fmpData = await fmpRes.json();
        if (fmpData[0]) {
          return {
            sharesOutstanding: fmpData[0].weightedAverageShsOut,
            float: fmpData[0].floatShares,
            source: 'FMP'
          };
        }
      }
      
      log('WARN', `Both SEC and FMP lookups failed for ${ticker}`);
      return null;
    }
    
    // Got shares outstanding from SEC, try SEC for float first
    let floatData = null;
    let floatSource = null;
    
    try {
      floatData = await getFloatFromSEC(cik);
      if (floatData) {
        floatSource = 'SEC';
      }
    } catch (err) {
      log('DEBUG', `SEC float lookup failed for ${ticker}: ${err.message}`);
    }
    
    // Fallback to FMP if SEC float didn't work
    if (!floatData) {
      try {
        const fmpKey = process.env.FMP_API_KEY || 'demo';
        const fmpRes = await fetchWithTimeout(`https://financialmodelingprep.com/api/v4/shares-float?symbol=${ticker}&apikey=${fmpKey}`, 10000);
        
        if (fmpRes.ok) {
          const fmpData = await fmpRes.json();
          if (fmpData[0]) {
            floatData = fmpData[0].floatShares;
            floatSource = 'FMP';
          }
        }
      } catch (err) {
        log('DEBUG', `FMP float lookup failed for ${ticker}: ${err.message}`);
      }
    }
    
    return {
      sharesOutstanding,
      float: floatData || null,
      source: floatSource ? `SEC+${floatSource}` : 'SEC'
    };
  } catch (err) {
    log('ERROR', `Failed to get ownership metrics for ${ticker}: ${err.message}`);
    return null;
  }
}

const sendPersonalWebhook = (alertData) => {
  try {
    // Check master toggle first
    if (!CONFIG.ALERTS_DISTRIBUTION_ENABLED) {
      return;
    }
    
    // Market hours check: only send personal alerts 7:30 AM - 4 PM ET, Mon-Fri
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etHour = etTime.getHours();
    const etMinutes = etTime.getMinutes();
    const dayOfWeek = etTime.getDay(); // 0=Sunday, 6=Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isMarketHours = (etHour >= 7 && (etHour > 7 || etMinutes >= 30)) && etHour < 16; // 7:30 AM - 3:59 PM (market closes at 4 PM)
    
    if (isWeekend || !isMarketHours) {
      log('INFO', `Skipping personal alert for $${alertData.ticker} - outside market hours (${etTime.toLocaleString('en-US', { timeZone: 'America/New_York' })})`);
      return;
    }
    
    // Personal alert location whitelist: only send from specific jurisdictions
    const personalAlertWhitelist = ['Delaware', 'Israel', 'China', 'Hong Kong', 'Singapore', 'Cayman Islands', 'BVI'];
    let incorporatedJurisdiction = alertData.incorporated ? alertData.incorporated.trim() : '';
    
    // Personal alert float filter: max 25M float
    const alertFloat = parseFloat(alertData.float) || 0;
    if (alertFloat > CONFIG.PERSONAL_ALERT_MAX_FLOAT && alertFloat !== 0) {
      log('INFO', `Skipping personal alert for $${alertData.ticker} - float ${(alertFloat / 1000000).toFixed(1)}M exceeds personal alert limit of 25M`);
      return;
    }
    
    // Extract just the state/country name (handle cases like "Wilmington, Delaware" → "Delaware")
    if (incorporatedJurisdiction.includes(',')) {
      const parts = incorporatedJurisdiction.split(',').map(p => p.trim());
      incorporatedJurisdiction = parts[parts.length - 1]; // Take last part (state/country)
    }
    
    if (incorporatedJurisdiction && !personalAlertWhitelist.includes(incorporatedJurisdiction)) {
      log('INFO', `Skipping personal alert for $${alertData.ticker} - jurisdiction '${incorporatedJurisdiction}' not whitelisted for personal alerts`);
      return;
    }
    
    // Send Discord alerts to personal webhook (detailed format)
    if (!CONFIG.PERSONAL_WEBHOOK_ENABLED) {
      return;
    }
    if (!CONFIG.PERSONAL_WEBHOOK_URL) {
      log('WARN', 'Personal webhook URL not configured');
      return;
    }
    
    const { ticker, price, intent, incorporated, located } = alertData;
    const direction = alertData.direction || 'LONG';
    
    // Convert intent categories to actual semantic keywords from SEMANTIC_KEYWORDS mapping
    let semanticKeywords = [];
    if (intent && Array.isArray(intent)) {
      for (const category of intent) {
        if (SEMANTIC_KEYWORDS[category]) {
          // Take up to 3 most relevant keywords per category for brevity
          semanticKeywords.push(...SEMANTIC_KEYWORDS[category].slice(0, 3));
        }
      }
    }
    const reason = semanticKeywords.length > 0 ? semanticKeywords.join(', ') : (intent || 'Filing');
    const priceDisplay = price && price !== 'N/A' ? `$${parseFloat(price).toFixed(2)}` : 'N/A';
    const floatDisplay = alertData.float && alertData.float !== 'N/A' ? (alertData.float / 1000000).toFixed(2) + 'm' : 'N/A';
    const volumeDisplay = alertData.volume && alertData.volume !== 'N/A' ? (alertData.volume / 1000000).toFixed(2) + 'm' : 'N/A';
    const avgVolDisplay = alertData.averageVolume && alertData.averageVolume !== 'N/A' ? (alertData.averageVolume / 1000000).toFixed(2) + 'm' : 'N/A';
    const marketCapDisplay = alertData.marketCap && alertData.marketCap !== 'N/A' ? `$${(alertData.marketCap / 1000000000).toFixed(2)}B` : 'N/A';
    const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${alertData.cik}&type=6-K&dateb=&owner=exclude&count=100`;
    const waDisplay = alertData.wa && alertData.wa !== 'N/A' ? `$${parseFloat(alertData.wa).toFixed(2)}` : 'N/A';
    const favDisplay = alertData.fav && alertData.fav !== 'N/A' ? alertData.fav + 'x' : 'N/A';
    const ftdDisplay = alertData.ftdPercent ? `${alertData.ftdPercent}%` : 'N/A';
    const soDisplay = alertData.soRatio || 'N/A';
    
    // Build bonuses
    const bonusItems = [];
    if (alertData.hasTuesdayBonus) bonusItems.push('Tuesday 1.2x');
    if (alertData.custodianControl) {
      const custodianLabel = alertData.custodianVerified ? `${alertData.custodianName} 1.3x` : `${alertData.custodianName} 1.15x`;
      bonusItems.push(custodianLabel);
    }
    if (alertData.filingTimeBonus) bonusItems.push(`Filing Time ${alertData.filingTimeBonus}x`);
    if (alertData.soBonus && alertData.soBonus > 1.0) bonusItems.push(`S/O ${alertData.soBonus}x`);
    if (alertData.bonusSignals && typeof alertData.bonusSignals === 'object') {
      if (alertData.bonusSignals['DTC Chill Lift']) bonusItems.push('DTC Chill Lift');
      if (alertData.bonusSignals['Shell Recycling']) bonusItems.push('Shell Recycling');
      if (alertData.bonusSignals['VStock']) bonusItems.push('Transfer Agent Change');
      if (alertData.bonusSignals['NT 10K'] === 'NT 10K Filed') bonusItems.push('Late Filing Notice');
      if (alertData.bonusSignals['NT 10K'] === 'Actual 10K Filed') bonusItems.push('10-K Filing');
    }
    const bonusDisplay = bonusItems.length > 0 ? bonusItems.join(' + ') : 'None';
    
    // Detect highest probability setup
    const intents = alertData.intent && Array.isArray(alertData.intent) ? alertData.intent : (alertData.intent ? alertData.intent.split(', ') : []);
    const ftdValue = parseFloat(alertData.ftdPercent) || 0;
    
    let setupTag = '';
    if (direction === 'SHORT') {
      const hasShortSetup = intents.includes('Credit Default') && 
                           intents.includes('Executive Liquidation') &&
                           intents.includes('Going Dark') &&
                           ftdValue > 5;
      if (hasShortSetup) {
        setupTag = '\n★ Highest Probability Setup';
      }
    } else if (direction === 'LONG') {
      const hasLongSetup = intents.includes('FDA Approved') &&
                          intents.includes('Stock Buyback') &&
                          intents.includes('Partnership') &&
                          intents.includes('Capital Raise');
      if (hasLongSetup) {
        setupTag = '\n★ Highest Probability Setup';
      }
    }
    
    // PERSONAL WEBHOOK: Detailed format 
    const sectorDisplay = alertData.sector || 'N/A';
    const locationDisplay = alertData.located || 'N/A';
    const incorporationDisplay = alertData.incorporated || 'N/A';
    const alertTypeDisplay = alertData.alertType && alertData.alertType.includes('CTB') ? `${alertData.alertType} ` : '';
    const personalAlertContent = `${alertTypeDisplay}[${direction}] $${ticker} @ ${priceDisplay}${setupTag}

**Signals:** ${reason}
**Industry:** ${sectorDisplay}
**Location:** ${locationDisplay}
**Incorporation:** ${incorporationDisplay}
**Float:** ${floatDisplay} / **S/O:** ${soDisplay}
**Volume:** Current: ${volumeDisplay} / **Average:** ${avgVolDisplay}
**Market Cap:** ${marketCapDisplay}
**F/AV:** ${favDisplay}
**FTD %:** ${ftdDisplay}

https://www.tradingview.com/chart/?symbol=${ticker}
${secLink}`;
    
    const personalMsg = { content: personalAlertContent };
    
    // Send to personal Discord webhook using node-fetch
    fetch(CONFIG.PERSONAL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(personalMsg),
      timeout: 5000
    }).catch(() => {});
  } catch (err) {
    log('ERROR', `Personal webhook error: ${err.message}`);
  }
};

const sendPaidWebhook = (alertData) => {
  try {
    // Check master toggle first
    if (!CONFIG.ALERTS_DISTRIBUTION_ENABLED) {
      return;
    }
    // Send Discord alerts to paid webhook (Telegram style format)
    if (!CONFIG.PAID_WEBHOOK_ENABLED) {
      return;
    }
    if (!CONFIG.PAID_WEBHOOK_URL) {
      log('WARN', 'Paid webhook URL not configured');
      return;
    }
    
    const { ticker, price, intent, incorporated, located } = alertData;
    const direction = alertData.direction || 'LONG';
    const priceDisplay = price && price !== 'N/A' ? `$${parseFloat(price).toFixed(2)}` : 'N/A';
    const floatDisplay = alertData.float && alertData.float !== 'N/A' ? (alertData.float / 1000000).toFixed(2) + 'm' : 'N/A';
    const volumeDisplay = alertData.volume && alertData.volume !== 'N/A' ? (alertData.volume / 1000000).toFixed(2) + 'm' : 'N/A';
    const avgVolDisplay = alertData.averageVolume && alertData.averageVolume !== 'N/A' ? (alertData.averageVolume / 1000000).toFixed(2) + 'm' : 'N/A';
    const marketCapDisplay = alertData.marketCap && alertData.marketCap !== 'N/A' ? `$${(alertData.marketCap / 1000000000).toFixed(2)}B` : 'N/A';
    const sideEmoji = direction === 'SHORT' ? '🔴 SHORT' : '🟢 LONG';
    
    // PAID WEBHOOK: Telegram style (clean, minimal, no branding)
    const paidAlertContent = `Ж NEW ALERT: $${ticker}\n${sideEmoji}\n\nEntry: ${priceDisplay}\nFloat: ${floatDisplay}\nVolume: ${volumeDisplay} (Avg: ${avgVolDisplay})\nS/O: ${alertData.soRatio || 'N/A'}\nMarket Cap: ${marketCapDisplay}\n\nhttps://www.tradingview.com/chart/?symbol=${ticker}`;
    
    
    const paidMsg = { content: paidAlertContent };
    
    // Send to paid Discord webhook using node-fetch
    fetch(CONFIG.PAID_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paidMsg),
      timeout: 5000
    }).catch(err => {
      log('WARN', `Discord: Send failed - ${err.message}`);
    });
  } catch (err) {
    log('ERROR', `Paid webhook error: ${err.message}`);
  }
};

const sendTelegramAlert = (alertData) => {
  try {
    // Check master toggle first
    if (!CONFIG.ALERTS_DISTRIBUTION_ENABLED) {
      return;
    }
    // Skip if Telegram credentials not configured
    if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
      log('WARN', 'Telegram credentials not configured');
      return;
    }
    
    const { ticker, price, intent, incorporated, located } = alertData;
    const direction = alertData.direction || 'LONG';
    const priceDisplay = price && price !== 'N/A' ? `$${parseFloat(price).toFixed(2)}` : 'N/A';
    const floatDisplay = alertData.float && alertData.float !== 'N/A' ? (alertData.float / 1000000).toFixed(2) + 'm' : 'N/A';
    const volumeDisplay = alertData.volume && alertData.volume !== 'N/A' ? (alertData.volume / 1000000).toFixed(2) + 'm' : 'N/A';
    const avgVolDisplay = alertData.averageVolume && alertData.averageVolume !== 'N/A' ? (alertData.averageVolume / 1000000).toFixed(2) + 'm' : 'N/A';
    const marketCapDisplay = alertData.marketCap && alertData.marketCap !== 'N/A' ? `$${(alertData.marketCap / 1000000000).toFixed(2)}B` : 'N/A';
    const sideEmoji = direction === 'SHORT' ? '🔴 SHORT' : '🟢 LONG';
    
    const telegramAlertContent = `🚀 NEW TRADE ALERT: $${ticker}\n${sideEmoji}\n\nEntry: ${priceDisplay}\nFloat: ${floatDisplay}\nVolume: ${volumeDisplay} (Avg: ${avgVolDisplay})\nS/O: ${alertData.soRatio || 'N/A'}\nMarket Cap: ${marketCapDisplay}\n\nhttps://www.tradingview.com/chart/?symbol=${ticker}`;
    
    const telegramUrl = `https://api.telegram.org/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const telegramPayload = {
      chat_id: CONFIG.TELEGRAM_CHAT_ID,
      text: telegramAlertContent
    };
    
    // Send Telegram asynchronously without blocking
    setImmediate(() => {
      fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegramPayload),
        timeout: 3000
      }).catch(err => {
        log('WARN', `Telegram: Send failed - ${err.message}`);
      });
    });
  } catch (err) {
    log('ERROR', `Telegram error: ${err.message}`);
  }
};

const pushToGitHub = () => {
  // Check if alert distribution is enabled
  if (!CONFIG.ALERTS_DISTRIBUTION_ENABLED) {
    return; // Skip push if alerts distribution is disabled
  }
  
  // Check if GitHub push is enabled
  if (!CONFIG.GITHUB_PUSH_ENABLED || !CONFIG.GITHUB_PAGES_ENABLED) {
    return; // Skip push if disabled
  }

  try {
    const projectRoot = CONFIG.GITHUB_REPO_PATH;
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    
    // Use git commands directly without cd - assumes app is running from repo root
    const gitCommands = [
      'git add logs/alert.json logs/stocks.json logs/quote.json docs/check.py 2>/dev/null || true',
      `git commit -m "Auto: Alert update ${timestamp}" 2>/dev/null || true`,
      'git push origin main 2>&1'
    ].join(' && ');
    
    // Run git push in background, don't wait for it
    require('child_process').exec(gitCommands, { 
      cwd: projectRoot, // Set working directory instead of using cd
      timeout: 10000, // 10 second timeout for git operations
      shell: '/bin/bash'
    }, (error, stdout, stderr) => {
      if (error) {
        log('WARN', `Git push error: ${error.message}`);
        if (stderr) log('WARN', `Git stderr: ${stderr}`);
      } else if (stdout) {
        log('INFO', `Git push: ${stdout.substring(0, 80).replace(/\n/g, ' ')}`);
      }
    });
  } catch (err) {
    log('ERR', `Git operations failed: ${err.message}`);
  }
};

const app = express();

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers - production grade
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Remove powered by header
  res.removeHeader('X-Powered-By');
  
  // HSTS for HTTPS
  if (req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  next();
});

// Input validation and sanitization middleware
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.body) {
    // Validate and sanitize common fields
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return str;
      // Remove null bytes and control characters
      return str.replace(/[\x00-\x1F\x7F]/g, '').trim();
    };
    
    // Sanitize body fields
    if (req.body.email) req.body.email = sanitizeString(req.body.email).toLowerCase();
    if (req.body.password) req.body.password = sanitizeString(req.body.password);
    if (req.body.fullName) req.body.fullName = sanitizeString(req.body.fullName);
    if (req.body.company) req.body.company = sanitizeString(req.body.company);
    if (req.body.code) req.body.code = sanitizeString(req.body.code);
    if (req.body.accessCode) req.body.accessCode = sanitizeString(req.body.accessCode);
  }
  next();
});

// Simple in-memory rate limiting for auth endpoints
const rateLimitStore = new Map();
const rateLimitMiddleware = (maxAttempts = 10, windowMs = 60000) => {
  return (req, res, next) => {
    if (!req.path.includes('/api/auth') && !req.path.includes('/api/login')) {
      return next();
    }
    
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let record = rateLimitStore.get(clientIp);
    
    if (record && now > record.resetTime) {
      rateLimitStore.delete(clientIp);
      record = null;
    }
    
    if (!record) {
      rateLimitStore.set(clientIp, { attempts: 1, resetTime: now + windowMs });
      return next();
    }
    
    record.attempts++;
    if (record.attempts > maxAttempts) {
      return res.status(429).json({ success: false, error: 'Too many attempts' });
    }
    next();
  };
};

app.use(rateLimitMiddleware(10, 60000));

// Email-based authentication setup
let emailTransporter = null;
try {
  if (CONFIG.SMTP_USER && CONFIG.SMTP_PASS) {
    const nodemailer = require('nodemailer');
    emailTransporter = nodemailer.createTransport({
      host: CONFIG.SMTP_HOST,
      port: CONFIG.SMTP_PORT,
      secure: CONFIG.SMTP_PORT === 465,
      auth: {
        user: CONFIG.SMTP_USER,
        pass: CONFIG.SMTP_PASS
      }
    });
    log('INFO', `Email transporter initialized: ${CONFIG.SMTP_HOST}:${CONFIG.SMTP_PORT}`);
  } else {
    log('WARN', 'Email credentials missing - check SMTP_USER and SMTP_PASS in .env');
  }
} catch (err) {
  log('ERROR', `Failed to initialize email transport: ${err.message}`);
}

// Email-based authentication middleware (first factor)
const auth = (req, res, next) => {
  // Skip auth for static files and certain endpoints
  if (req.path === '/api/auth-send-code' || req.path === '/api/auth-verify' || 
      req.path === '/api/auth-register' || req.path === '/api/auth-verify-register' ||
      req.path === '/api/login-verify' || req.path === '/api/ping' || 
      req.path === '/api/send-access-request' ||
      req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/i)) {
    return next();
  }

  // Check if session is already authenticated
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid;
  
  if (sessionId && approvedSessions.has(sessionId)) {
    return next(); // Already authenticated
  }

  // Not authenticated - send to login page
  return res.status(401).send(renderLoginPage());
};

// In-memory structures for email-based authentication and manual approval (second factor)
const pendingEmails = new Map(); // email -> { code, createdAt, attempts }
const pendingLogins = new Map(); // sessionId -> { email, ip, country, userAgent, time, headers, createdAt, userAccepted }
const approvedSessions = new Set(); // sessionIds that have been approved
const deniedSessions = new Set(); // sessionIds that have been explicitly denied
const purchaseCodes = new Map(); // purchaseCode -> { email, createdAt, used, usedAt, usedBy }
let lastPendingSessionId = null; // track the most recent pending login for quick "yes/no" commands
let rl = null; // readline interface for terminal commands
let hasInteractivePrompt = false; // whether we have an interactive terminal

// User registration storage
const registeredUsers = new Map(); // email -> { email, fullName, company, passwordHash, createdAt, lastLogin }
const userStorageFile = 'logs/users.json';

// Load users from storage
const loadUsers = () => {
  try {
    if (fs.existsSync(userStorageFile)) {
      const content = fs.readFileSync(userStorageFile, 'utf8').trim();
      if (content) {
        const users = JSON.parse(content);
        for (const [email, userData] of Object.entries(users)) {
          registeredUsers.set(email.toLowerCase(), userData);
        }
        log('INFO', `Loaded ${registeredUsers.size} registered users`);
      }
    }
  } catch (err) {
    log('WARN', `Failed to load users: ${err.message}`);
  }
};

// Save users to storage
const saveUsers = () => {
  try {
    const usersObj = {};
    for (const [email, userData] of registeredUsers) {
      usersObj[email] = userData;
    }
    fs.writeFileSync(userStorageFile, JSON.stringify(usersObj, null, 2));
  } catch (err) {
    log('WARN', `Failed to save users: ${err.message}`);
  }
};

// Session/Activity tracking
const userSessions = new Map(); // email -> [{ sessionId, ip, location, userAgent, loginTime, lastActivity }]
const sessionsFile = 'logs/sessions.json';

// Load sessions from storage
const loadSessions = () => {
  try {
    if (fs.existsSync(sessionsFile)) {
      const content = fs.readFileSync(sessionsFile, 'utf8').trim();
      if (content) {
        const sessions = JSON.parse(content);
        for (const [email, emailSessions] of Object.entries(sessions)) {
          userSessions.set(email.toLowerCase(), emailSessions || []);
        }
      }
    }
  } catch (err) {
    log('WARN', `Failed to load sessions: ${err.message}`);
  }
};

// Save sessions to storage
const saveSessions = () => {
  try {
    const sessionsObj = {};
    for (const [email, sessions] of userSessions) {
      sessionsObj[email] = sessions;
    }
    fs.writeFileSync(sessionsFile, JSON.stringify(sessionsObj, null, 2));
  } catch (err) {
    log('WARN', `Failed to save sessions: ${err.message}`);
  }
};

// Log session activity
const logSession = (email, sessionId, ip, userAgent, location) => {
  const emailLower = email.toLowerCase();
  if (!userSessions.has(emailLower)) {
    userSessions.set(emailLower, []);
  }
  
  const sessions = userSessions.get(emailLower);
  const now = new Date().toISOString();
  
  // Check if this sessionId already exists (update)
  const existing = sessions.find(s => s.sessionId === sessionId);
  if (existing) {
    existing.lastActivity = now;
  } else {
    // New session
    sessions.push({
      sessionId,
      ip,
      location: location || 'Unknown',
      userAgent: userAgent || 'Unknown',
      loginTime: now,
      lastActivity: now
    });
  }
  
  // Keep only last 10 sessions per user
  if (sessions.length > 10) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    userSessions.set(emailLower, sessions.slice(0, 10));
  }
  
  saveSessions();
};

// Get user's active sessions
const getUserSessions = (email) => {
  const emailLower = email.toLowerCase();
  const sessions = userSessions.get(emailLower) || [];
  
  // Filter sessions active in last 1 hour
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  return sessions.filter(s => s.lastActivity > oneHourAgo);
};

// Load sessions on startup
loadSessions();// Load users on startup
loadUsers();

const generateSessionId = () => crypto.randomBytes(8).toString('hex');
const generateOTP = () => crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars

// Render login page for email entry
const renderLoginPage = () => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Portal</title>
  <link rel="icon" type="image/jpeg" href="/docs/logo.jpeg">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;800&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Crafty+Girls&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Gaegu&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=El+Messiri:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Söhne', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
      background-color: #f5f5f5;
      background-attachment: fixed;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      color: #333;
      transition: background 0.3s ease, color 0.3s ease;
      position: relative;
      overflow: hidden;
      box-sizing: border-box;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-text-size-adjust: 100%;
    }
    @supports (padding: max(0px)) {
      body {
        padding-bottom: max(20px, env(safe-area-inset-bottom));
        padding-left: max(20px, env(safe-area-inset-left));
        padding-right: max(20px, env(safe-area-inset-right));
      }
    }
    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, rgba(240, 240, 240, 0) 0%, rgba(200, 200, 200, 0.03) 50%, rgba(220, 220, 220, 0) 100%);
      pointer-events: none;
      z-index: -1;
    }
    body::after {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      transform: translateZ(0);
      background-image: 
        radial-gradient(3.3px 3.3px at 10% 20%, rgba(100, 100, 100, 0.60) 1px, transparent 1px),
        radial-gradient(1.1px 1.1px at 80% 80%, rgba(100, 100, 100, 0.40) 1px, transparent 1px),
        radial-gradient(3.08px 3.08px at 40% 60%, rgba(100, 100, 100, 0.55) 1px, transparent 1px),
        radial-gradient(1.43px 1.43px at 70% 30%, rgba(100, 100, 100, 0.43) 1px, transparent 1px),
        radial-gradient(3.52px 3.52px at 20% 90%, rgba(100, 100, 100, 0.57) 1px, transparent 1px),
        radial-gradient(0.77px 0.77px at 50% 10%, rgba(100, 100, 100, 0.33) 1px, transparent 1px),
        radial-gradient(2.75px 2.75px at 30% 40%, rgba(100, 100, 100, 0.53) 1px, transparent 1px),
        radial-gradient(1.21px 1.21px at 90% 50%, rgba(100, 100, 100, 0.37) 1px, transparent 1px),
        radial-gradient(3.41px 3.41px at 60% 75%, rgba(100, 100, 100, 0.56) 1px, transparent 1px),
        radial-gradient(0.99px 0.99px at 15% 55%, rgba(100, 100, 100, 0.35) 1px, transparent 1px),
        radial-gradient(2.86px 2.86px at 35% 15%, rgba(100, 100, 100, 0.54) 1px, transparent 1px),
        radial-gradient(1.65px 1.65px at 75% 45%, rgba(100, 100, 100, 0.45) 1px, transparent 1px),
        radial-gradient(3.63px 3.63px at 25% 70%, rgba(100, 100, 100, 0.58) 1px, transparent 1px),
        radial-gradient(0.66px 0.66px at 55% 35%, rgba(100, 100, 100, 0.30) 1px, transparent 1px),
        radial-gradient(3.19px 3.19px at 85% 65%, rgba(100, 100, 100, 0.55) 1px, transparent 1px),
        radial-gradient(2.2px 2.2px at 5% 75%, rgba(100, 100, 100, 0.50) 1px, transparent 1px),
        radial-gradient(1.8px 1.8px at 95% 10%, rgba(100, 100, 100, 0.47) 1px, transparent 1px),
        radial-gradient(3.4px 3.4px at 60% 25%, rgba(100, 100, 100, 0.59) 1px, transparent 1px),
        radial-gradient(0.88px 0.88px at 25% 85%, rgba(100, 100, 100, 0.37) 1px, transparent 1px),
        radial-gradient(2.95px 2.95px at 75% 65%, rgba(100, 100, 100, 0.52) 1px, transparent 1px);
      background-size: 
        300px 350px,
        400px 420px,
        350px 300px,
        450px 500px,
        380px 420px,
        280px 380px,
        420px 340px,
        360px 410px,
        400px 360px,
        320px 390px,
        390px 400px,
        410px 380px,
        370px 420px,
        340px 360px,
        440px 470px,
        360px 340px,
        420px 390px,
        380px 360px,
        400px 410px,
        430px 370px;
      background-repeat: repeat;
      background-position: 0 0, 50px 30px, 80px 60px, 120px 40px, 30px 90px, 160px 20px, 70px 150px, 200px 80px, 110px 200px, 250px 110px, 40px 160px, 180px 45px, 220px 120px, 90px 250px, 280px 180px, 130px 20px, 310px 90px, 160px 290px, 60px 225px, 330px 240px;
      pointer-events: none;
      z-index: -1;
      animation: floatParticles1 60s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles2 73s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles3 87s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles4 67s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles5 80s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles6 63s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles7 77s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles8 70s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles9 83s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles10 90s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles11 57s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles12 93s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles13 65s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles14 78s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles15 97s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles16 68s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles17 82s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles18 72s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles19 85s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles20 92s cubic-bezier(0.34, 0, 0.66, 1) infinite;
    }
    @keyframes floatParticles1 {
      0% { background-position: 0 0, 50px 30px, 80px 60px, 120px 40px, 30px 90px, 160px 20px, 70px 150px, 200px 80px, 110px 200px, 250px 110px; opacity: 0.3; }
      25% { background-position: 48px -115px, 98px -85px, 128px -55px, 168px -85px, 78px -85px, 208px -95px, 118px 35px, 248px -35px, 158px 85px, 298px -5px; opacity: 0.5; }
      50% { background-position: 25px -165px, 75px -135px, 105px -105px, 145px -135px, 55px -135px, 185px -145px, 95px -15px, 225px -85px, 135px 35px, 275px -55px; opacity: 0.6; }
      75% { background-position: -32px -135px, 18px -105px, 48px -75px, 88px -105px, -2px -105px, 128px -115px, 38px 15px, 168px -55px, 78px 65px, 218px -25px; opacity: 0.4; }
      100% { background-position: 0 -220px, 50px -190px, 80px -160px, 120px -190px, 30px -190px, 160px -200px, 70px -100px, 200px -140px, 110px -50px, 250px -110px; opacity: 0.2; }
    }
    @keyframes floatParticles2 {
      0% { background-position: 100px 0, 20px 50px, 150px 80px, 60px 120px, 200px 30px, 70px 180px, 240px 100px, 120px 220px, 290px 140px, 180px 260px; opacity: 0.35; }
      25% { background-position: 48px -88px, -32px 2px, 98px -8px, 8px 32px, 148px -58px, 18px 92px, 188px 12px, 68px 132px, 238px 52px, 128px 172px; opacity: 0.55; }
      50% { background-position: 18px -148px, -62px -58px, 68px -68px, -22px -28px, 118px -118px, -12px 32px, 158px -48px, 38px 72px, 208px -8px, 98px 112px; opacity: 0.65; }
      75% { background-position: -22px -118px, -32px 22px, 108px -38px, 38px 42px, 158px -88px, 28px 62px, 198px -18px, 78px 102px, 248px 22px, 138px 142px; opacity: 0.45; }
      100% { background-position: 100px -198px, 20px -148px, 150px -118px, 60px -68px, 200px -168px, 70px -48px, 240px -88px, 120px 32px, 290px -48px, 180px 72px; opacity: 0.15; }
    }
    @keyframes floatParticles3 {
      0% { background-position: 50px 100px, 120px 20px, 30px 150px, 200px 60px, 80px 200px, 220px 40px, 140px 160px, 280px 80px, 170px 240px, 320px 120px; opacity: 0.32; }
      25% { background-position: 112px -22px, 182px -78px, 92px 28px, 262px -38px, 142px 62px, 282px -48px, 202px 12px, 342px -58px, 232px 82px, 32px -28px; opacity: 0.52; }
      50% { background-position: 122px -68px, 192px -128px, 102px -18px, 272px -88px, 152px 12px, 292px -98px, 212px -38px, 352px -108px, 242px 32px, 42px -78px; opacity: 0.62; }
      75% { background-position: 82px -38px, 152px -98px, 62px 12px, 232px -58px, 112px 42px, 252px -68px, 172px 8px, 312px -78px, 202px 62px, 2px -48px; opacity: 0.42; }
      100% { background-position: 50px -225px, 120px -180px, 30px -50px, 200px -140px, 80px -25px, 220px -135px, 140px -75px, 280px -155px, 170px 15px, 320px -95px; opacity: 0.12; }
    }
    @keyframes floatParticles4 {
      0% { background-position: 200px 50px, 80px 150px, 120px 90px, 40px 200px, 160px 120px, 260px 170px, 180px 220px, 320px 140px, 100px 280px, 240px 200px; opacity: 0.38; }
      25% { background-position: 162px -45px, 42px 55px, 82px -5px, 2px 105px, 122px 25px, 222px 75px, 142px 125px, 282px 45px, 62px 185px, 202px 105px; opacity: 0.58; }
      50% { background-position: 128px -105px, 8px -5px, 48px -65px, -32px 45px, 88px -35px, 188px 15px, 108px 65px, 248px -15px, 28px 125px, 168px 45px; opacity: 0.68; }
      75% { background-position: 148px -75px, 28px 25px, 68px -35px, -12px 75px, 108px -5px, 208px 45px, 128px 95px, 268px 15px, 48px 155px, 188px 75px; opacity: 0.48; }
      100% { background-position: 200px -205px, 80px -55px, 120px -115px, 40px 35px, 160px -85px, 260px -35px, 180px 15px, 320px -65px, 100px 95px, 240px 15px; opacity: 0.18; }
    }
    @keyframes floatParticles5 {
      0% { background-position: 150px 200px, 30px 100px, 200px 40px, 90px 160px, 50px 80px, 280px 120px, 170px 260px, 310px 180px, 120px 240px, 350px 160px; opacity: 0.3; }
      25% { background-position: 195px 88px, 75px -12px, 245px -72px, 135px 48px, 95px -32px, 325px 8px, 215px 148px, 355px 68px, 165px 128px, 35px 48px; opacity: 0.5; }
      50% { background-position: 178px -62px, 58px -112px, 228px -162px, 118px -52px, 78px -132px, 308px -92px, 198px 48px, 338px -32px, 148px 28px, 18px -52px; opacity: 0.6; }
      75% { background-position: 125px -32px, 5px -82px, 175px -132px, 65px -22px, 25px -102px, 255px -62px, 145px 78px, 285px 2px, 95px 58px, -35px -22px; opacity: 0.4; }
      100% { background-position: 150px -218px, 30px -118px, 200px -158px, 90px -98px, 50px -178px, 280px -138px, 170px -68px, 310px 12px, 120px -48px, 350px -68px; opacity: 0.1; }
    }
    @keyframes floatParticles6 {
      0% { background-position: 80px 120px, 240px 60px, 160px 180px, 110px 100px, 190px 140px, 320px 80px, 200px 220px, 130px 160px, 270px 240px, 340px 200px; opacity: 0.28; }
      25% { background-position: 25px 28px, 185px -32px, 105px 88px, 55px 8px, 135px 48px, 265px -12px, 145px 128px, 75px 68px, 215px 148px, 285px 108px; opacity: 0.48; }
      50% { background-position: -5px -32px, 155px -92px, 75px 28px, 25px -52px, 105px -12px, 235px -72px, 115px 68px, 45px 8px, 185px 88px, 255px 48px; opacity: 0.58; }
      75% { background-position: 35px -2px, 195px -62px, 115px 58px, 65px -22px, 145px 18px, 275px -42px, 155px 98px, 85px 38px, 225px 118px, 295px 78px; opacity: 0.38; }
      100% { background-position: 80px -210px, 240px -150px, 160px -30px, 110px -110px, 190px -70px, 320px -130px, 200px -50px, 130px -110px, 270px -30px, 340px -90px; opacity: 0.08; }
    }
    @keyframes floatParticles7 {
      0% { background-position: 220px 80px, 70px 200px, 140px 120px, 180px 90px, 60px 160px, 290px 200px, 150px 280px, 340px 140px, 210px 260px, 310px 220px; opacity: 0.33; }
      25% { background-position: 288px -18px, 138px 82px, 208px 2px, 248px -28px, 128px 42px, 358px 82px, 218px 162px, 8px 22px, 278px 142px, 28px 102px; opacity: 0.53; }
      50% { background-position: 298px -68px, 148px 32px, 218px -48px, 258px -78px, 138px -8px, 368px 32px, 228px 112px, 18px -28px, 288px 92px, 38px 52px; opacity: 0.63; }
      75% { background-position: 258px -38px, 108px 62px, 178px 22px, 218px -48px, 98px 22px, 328px 62px, 188px 142px, -22px 2px, 248px 122px, -2px 82px; opacity: 0.43; }
      100% { background-position: 220px -215px, 70px -35px, 140px -80px, 180px -110px, 60px -40px, 290px -110px, 150px 15px, 340px -145px, 210px -65px, 310px -125px; opacity: 0.13; }
    }
    @keyframes floatParticles8 {
      0% { background-position: 140px 150px, 260px 100px, 100px 220px, 50px 130px, 210px 70px, 340px 180px, 180px 240px, 320px 160px, 240px 280px, 160px 200px; opacity: 0.36; }
      25% { background-position: 98px 45px, 218px -5px, 58px 115px, 8px 25px, 168px -35px, 298px 75px, 138px 135px, 278px 55px, 198px 175px, 118px 95px; opacity: 0.56; }
      50% { background-position: 65px -50px, 185px -105px, 25px 20px, -25px -70px, 135px -135px, 265px -25px, 105px 35px, 245px -45px, 165px 75px, 85px -5px; opacity: 0.66; }
      75% { background-position: 85px -20px, 205px -75px, 45px 50px, -5px -40px, 155px -105px, 285px 5px, 125px 65px, 265px -15px, 185px 105px, 105px 25px; opacity: 0.46; }
      100% { background-position: 140px -212px, 260px -130px, 100px -80px, 50px -170px, 210px -130px, 340px -120px, 180px 32px, 320px -145px, 240px -48px, 160px -30px; opacity: 0.16; }
    }
    @keyframes floatParticles9 {
      0% { background-position: 190px 60px, 110px 180px, 280px 120px, 170px 200px, 90px 140px, 330px 240px, 240px 160px, 360px 280px, 150px 220px, 380px 180px; opacity: 0.31; }
      25% { background-position: 242px -48px, 162px 82px, 332px 22px, 222px 102px, 142px 42px, 382px 142px, 292px 62px, 12px 182px, 202px 122px, 32px 82px; opacity: 0.51; }
      50% { background-position: 222px -108px, 142px 22px, 312px -38px, 202px 42px, 122px -18px, 362px 82px, 272px 2px, -8px 122px, 182px 62px, 12px 22px; opacity: 0.61; }
      75% { background-position: 172px -78px, 92px 52px, 262px 8px, 152px 72px, 72px 12px, 312px 112px, 222px 32px, -58px 152px, 132px 92px, -38px 52px; opacity: 0.41; }
      100% { background-position: 190px -222px, 110px -42px, 280px -80px, 170px 40px, 90px -40px, 330px 48px, 240px -80px, 360px 48px, 150px -32px, 380px 8px; opacity: 0.11; }
    }
    @keyframes floatParticles10 {
      0% { background-position: 120px 210px, 200px 140px, 75px 95px, 250px 160px, 140px 190px, 360px 250px, 260px 170px, 150px 300px, 300px 210px, 420px 240px; opacity: 0.29; }
      25% { background-position: 178px 112px, 258px 42px, 133px -3px, 308px 62px, 198px 92px, 418px 152px, 318px 72px, 208px 202px, 358px 112px, 28px 142px; opacity: 0.49; }
      50% { background-position: 202px 10px, 282px -60px, 157px -105px, 332px -40px, 222px -10px, 442px 50px, 342px -30px, 232px 100px, 382px 10px, 52px 40px; opacity: 0.59; }
      75% { background-position: 168px 40px, 248px -30px, 123px -75px, 298px -10px, 188px 20px, 408px 80px, 308px 0px, 198px 130px, 348px 40px, 18px 70px; opacity: 0.39; }
      100% { background-position: 120px -190px, 200px -120px, 75px -165px, 250px -80px, 140px -90px, 360px -60px, 260px -90px, 150px 30px, 300px -60px, 420px 0px; opacity: 0.09; }
    }
    @keyframes floatParticles11 {
      0% { background-position: 60px 50px, 180px 200px, 140px 120px, 280px 90px, 100px 260px, 320px 180px, 200px 240px, 160px 100px, 340px 160px, 240px 280px; opacity: 0.34; }
      25% { background-position: 18px -65px, 138px 85px, 98px 5px, 238px -25px, 58px 145px, 278px 65px, 158px 125px, 118px -15px, 298px 45px, 198px 165px; opacity: 0.54; }
      50% { background-position: -8px -128px, 108px 22px, 68px -58px, 208px -88px, 28px 82px, 248px 2px, 128px 62px, 88px -78px, 268px -18px, 168px 102px; opacity: 0.64; }
      75% { background-position: 22px -98px, 132px 52px, 92px -28px, 232px -58px, 52px 112px, 272px 32px, 152px 92px, 112px -48px, 292px 12px, 192px 132px; opacity: 0.44; }
      100% { background-position: 60px -185px, 180px 75px, 140px -145px, 280px -215px, 100px 95px, 320px -90px, 200px -75px, 160px -225px, 340px -155px, 240px 75px; opacity: 0.14; }
    }
    @keyframes floatParticles12 {
      0% { background-position: 210px 95px, 90px 180px, 320px 60px, 170px 240px, 260px 120px, 130px 280px, 380px 200px, 230px 150px, 80px 310px, 350px 100px; opacity: 0.31; }
      25% { background-position: 268px -28px, 148px 67px, 378px -53px, 228px 122px, 318px 5px, 188px 162px, 38px 82px, 288px 32px, 138px 192px, 8px -15px; opacity: 0.51; }
      50% { background-position: 288px -108px, 168px 7px, 398px -133px, 248px 42px, 338px -75px, 208px 82px, 58px 2px, 308px -48px, 158px 112px, 28px -95px; opacity: 0.61; }
      75% { background-position: 258px -78px, 138px 37px, 368px -103px, 218px 72px, 308px -45px, 178px 112px, 28px 32px, 278px -18px, 128px 142px, -2px -65px; opacity: 0.41; }
      100% { background-position: 210px -208px, 90px 95px, 320px -235px, 170px -85px, 260px -175px, 130px 65px, 380px -100px, 230px -165px, 80px 45px, 350px -215px; opacity: 0.11; }
    }
    @keyframes floatParticles13 {
      0% { background-position: 140px 165px, 270px 75px, 50px 220px, 310px 140px, 180px 280px, 400px 100px, 100px 195px, 340px 265px, 210px 60px, 70px 285px; opacity: 0.36; }
      25% { background-position: 198px 47px, 328px -43px, 108px 102px, 368px 22px, 238px 162px, 458px -18px, 158px 77px, 398px 147px, 268px -58px, 128px 167px; opacity: 0.56; }
      50% { background-position: 218px -53px, 348px -123px, 128px 22px, 388px -58px, 258px 82px, 478px -98px, 178px -3px, 418px 67px, 288px -138px, 148px 87px; opacity: 0.66; }
      75% { background-position: 188px -23px, 318px -93px, 98px 52px, 358px -28px, 228px 112px, 448px -68px, 148px 27px, 388px 97px, 258px -108px, 118px 117px; opacity: 0.46; }
      100% { background-position: 140px -198px, 270px -175px, 50px 75px, 310px -195px, 180px 30px, 400px -215px, 100px -120px, 340px 15px, 210px -225px, 70px 45px; opacity: 0.16; }
    }
    @keyframes floatParticles14 {
      0% { background-position: 280px 130px, 160px 245px, 380px 85px, 100px 155px, 340px 195px, 220px 70px, 60px 265px, 300px 110px, 200px 255px, 420px 165px; opacity: 0.32; }
      25% { background-position: 338px 12px, 218px 127px, 438px -33px, 158px 37px, 398px 77px, 278px -48px, 118px 147px, 358px -8px, 258px 137px, 478px 47px; opacity: 0.52; }
      50% { background-position: 358px -68px, 238px 47px, 458px -113px, 178px -43px, 418px -3px, 298px -128px, 138px 67px, 378px -88px, 278px 57px, 498px -33px; opacity: 0.62; }
      75% { background-position: 328px -38px, 208px 77px, 428px -83px, 148px -13px, 388px 27px, 268px -98px, 108px 97px, 348px -58px, 248px 87px, 468px -3px; opacity: 0.42; }
      100% { background-position: 280px -210px, 160px 85px, 380px -195px, 100px -175px, 340px 15px, 220px -225px, 60px 35px, 300px -195px, 200px 25px, 420px -135px; opacity: 0.12; }
    }
    @keyframes floatParticles15 {
      0% { background-position: 170px 175px, 310px 95px, 230px 260px, 70px 130px, 350px 225px, 150px 155px, 380px 295px, 110px 235px, 290px 65px, 440px 180px; opacity: 0.35; }
      25% { background-position: 228px 57px, 368px -23px, 288px 142px, 128px 12px, 408px 107px, 208px 37px, 438px 177px, 168px 117px, 348px -53px, 498px 62px; opacity: 0.55; }
      50% { background-position: 248px -43px, 388px -103px, 308px 62px, 148px -68px, 428px 27px, 228px -43px, 458px 97px, 188px 37px, 368px -133px, 518px -18px; opacity: 0.65; }
      75% { background-position: 218px -13px, 358px -73px, 278px 92px, 118px -38px, 398px 57px, 198px -13px, 428px 127px, 158px 67px, 338px -103px, 488px 12px; opacity: 0.45; }
      100% { background-position: 170px -192px, 310px -165px, 230px 130px, 70px -155px, 350px 95px, 150px -165px, 380px 145px, 110px 85px, 290px -235px, 440px 85px; opacity: 0.15; }
    }
    @keyframes floatParticles16 {
      0% { background-position: 240px 105px, 120px 210px, 360px 140px, 200px 240px, 80px 175px, 420px 120px, 160px 290px, 340px 90px, 260px 195px, 40px 250px; opacity: 0.33; }
      25% { background-position: 298px -13px, 178px 92px, 418px 22px, 258px 122px, 138px 57px, 478px 2px, 218px 172px, 398px -28px, 318px 77px, 98px 132px; opacity: 0.53; }
      50% { background-position: 318px -93px, 198px 12px, 438px -58px, 278px 42px, 158px -23px, 498px -78px, 238px 92px, 418px -108px, 338px -3px, 118px 52px; opacity: 0.63; }
      75% { background-position: 288px -63px, 168px 42px, 408px -28px, 248px 72px, 128px 7px, 468px -48px, 208px 122px, 388px -78px, 308px 27px, 88px 82px; opacity: 0.43; }
      100% { background-position: 240px -205px, 120px 95px, 360px -165px, 200px 125px, 80px 20px, 420px -165px, 160px 65px, 340px -215px, 260px -85px, 40px 125px; opacity: 0.13; }
    }
    @keyframes floatParticles17 {
      0% { background-position: 110px 140px, 350px 180px, 190px 95px, 330px 255px, 250px 140px, 90px 225px, 410px 185px, 170px 220px, 310px 140px, 130px 305px; opacity: 0.37; }
      25% { background-position: 168px 22px, 408px 62px, 248px -23px, 388px 137px, 308px 22px, 148px 107px, 468px 67px, 228px 102px, 368px 22px, 188px 187px; opacity: 0.57; }
      50% { background-position: 188px -58px, 428px -18px, 268px -103px, 408px 57px, 328px -58px, 168px 27px, 488px -13px, 248px 22px, 388px -58px, 208px 107px; opacity: 0.67; }
      75% { background-position: 158px -28px, 398px 12px, 238px -73px, 378px 87px, 298px -28px, 138px 57px, 458px 17px, 218px 52px, 358px -28px, 178px 137px; opacity: 0.47; }
      100% { background-position: 110px -185px, 350px 75px, 190px -165px, 330px 145px, 250px -85px, 90px 65px, 410px -95px, 170px 95px, 310px -155px, 130px 155px; opacity: 0.17; }
    }
    @keyframes floatParticles18 {
      0% { background-position: 320px 150px, 180px 160px, 400px 225px, 140px 185px, 300px 280px, 60px 210px, 280px 115px, 440px 245px, 220px 170px, 100px 285px; opacity: 0.34; }
      25% { background-position: 378px 32px, 238px 42px, 458px 107px, 198px 67px, 358px 162px, 118px 92px, 338px -3px, 498px 127px, 278px 52px, 158px 167px; opacity: 0.54; }
      50% { background-position: 398px -48px, 258px -38px, 478px 27px, 218px -13px, 378px 82px, 138px 12px, 358px -83px, 518px 47px, 298px -28px, 178px 87px; opacity: 0.64; }
      75% { background-position: 368px -18px, 228px -8px, 448px 57px, 188px 17px, 348px 112px, 108px 42px, 328px -53px, 488px 77px, 268px 2px, 148px 117px; opacity: 0.44; }
      100% { background-position: 320px -195px, 180px 95px, 400px -135px, 140px 125px, 300px 75px, 60px 15px, 280px -175px, 440px 135px, 220px -145px, 100px 165px; opacity: 0.14; }
    }
    @keyframes floatParticles19 {
      0% { background-position: 130px 195px, 370px 115px, 250px 275px, 190px 100px, 310px 165px, 70px 260px, 430px 235px, 150px 125px, 330px 280px, 210px 145px; opacity: 0.38; }
      25% { background-position: 188px 77px, 428px -3px, 308px 157px, 248px -18px, 368px 47px, 128px 142px, 488px 117px, 208px 7px, 388px 162px, 268px 27px; opacity: 0.58; }
      50% { background-position: 208px -3px, 448px -83px, 328px 77px, 268px -98px, 388px -33px, 148px 62px, 508px 37px, 228px -73px, 408px 82px, 288px -53px; opacity: 0.68; }
      75% { background-position: 178px 27px, 418px -53px, 298px 107px, 238px -68px, 358px -3px, 118px 92px, 478px 67px, 198px -43px, 378px 112px, 258px -23px; opacity: 0.48; }
      100% { background-position: 130px -165px, 370px 65px, 250px 145px, 190px -145px, 310px 45px, 70px 105px, 430px 115px, 150px -175px, 330px 115px, 210px 95px; opacity: 0.18; }
    }
    @keyframes floatParticles20 {
      0% { background-position: 290px 175px, 150px 125px, 370px 210px, 230px 280px, 110px 165px, 350px 245px, 190px 100px, 410px 155px, 70px 220px, 320px 280px; opacity: 0.36; }
      25% { background-position: 348px 57px, 208px 7px, 428px 92px, 288px 162px, 168px 47px, 408px 127px, 248px -18px, 468px 37px, 128px 102px, 378px 162px; opacity: 0.56; }
      50% { background-position: 368px -23px, 228px -73px, 448px 12px, 308px 82px, 188px -33px, 428px 47px, 268px -98px, 488px -43px, 148px 22px, 398px 82px; opacity: 0.66; }
      75% { background-position: 338px 7px, 198px -43px, 418px 42px, 278px 112px, 158px -3px, 398px 77px, 238px -68px, 458px -13px, 118px 52px, 368px 112px; opacity: 0.46; }
      100% { background-position: 290px -180px, 150px 95px, 370px -120px, 230px 105px, 110px 35px, 350px 115px, 190px -175px, 410px 55px, 70px -135px, 320px 135px; opacity: 0.16; }
    }
    body.dark-mode {
      background-color: #0d0d0d;
      color: #e0e0e0;
    }
    body.dark-mode::before {
      background: linear-gradient(135deg, rgba(20, 20, 20, 0) 0%, rgba(80, 80, 80, 0.04) 50%, rgba(60, 60, 60, 0) 100%);
    }
    body.dark-mode::after {
      background-image: 
        radial-gradient(3.3px 3.3px at 10% 20%, rgba(200, 200, 200, 0.55) 1px, transparent 1px),
        radial-gradient(1.1px 1.1px at 80% 80%, rgba(200, 200, 200, 0.35) 1px, transparent 1px),
        radial-gradient(3.08px 3.08px at 40% 60%, rgba(200, 200, 200, 0.5) 1px, transparent 1px),
        radial-gradient(1.43px 1.43px at 70% 30%, rgba(200, 200, 200, 0.38) 1px, transparent 1px),
        radial-gradient(3.52px 3.52px at 20% 90%, rgba(200, 200, 200, 0.52) 1px, transparent 1px),
        radial-gradient(0.77px 0.77px at 50% 10%, rgba(200, 200, 200, 0.28) 1px, transparent 1px),
        radial-gradient(2.75px 2.75px at 30% 40%, rgba(200, 200, 200, 0.48) 1px, transparent 1px),
        radial-gradient(1.21px 1.21px at 90% 50%, rgba(200, 200, 200, 0.32) 1px, transparent 1px),
        radial-gradient(3.41px 3.41px at 60% 75%, rgba(200, 200, 200, 0.51) 1px, transparent 1px),
        radial-gradient(0.99px 0.99px at 15% 55%, rgba(200, 200, 200, 0.3) 1px, transparent 1px),
        radial-gradient(2.86px 2.86px at 35% 15%, rgba(200, 200, 200, 0.49) 1px, transparent 1px),
        radial-gradient(1.65px 1.65px at 75% 45%, rgba(200, 200, 200, 0.4) 1px, transparent 1px),
        radial-gradient(3.63px 3.63px at 25% 70%, rgba(200, 200, 200, 0.53) 1px, transparent 1px),
        radial-gradient(0.66px 0.66px at 55% 35%, rgba(200, 200, 200, 0.25) 1px, transparent 1px),
        radial-gradient(3.19px 3.19px at 85% 65%, rgba(200, 200, 200, 0.5) 1px, transparent 1px),
        radial-gradient(2.2px 2.2px at 5% 75%, rgba(200, 200, 200, 0.45) 1px, transparent 1px),
        radial-gradient(1.8px 1.8px at 95% 10%, rgba(200, 200, 200, 0.42) 1px, transparent 1px),
        radial-gradient(3.4px 3.4px at 60% 25%, rgba(200, 200, 200, 0.54) 1px, transparent 1px),
        radial-gradient(0.88px 0.88px at 25% 85%, rgba(200, 200, 200, 0.32) 1px, transparent 1px),
        radial-gradient(2.95px 2.95px at 75% 65%, rgba(200, 200, 200, 0.47) 1px, transparent 1px);
      background-size: 
        300px 350px,
        400px 420px,
        350px 300px,
        450px 500px,
        380px 420px,
        280px 380px,
        420px 340px,
        360px 410px,
        400px 360px,
        320px 390px,
        390px 400px,
        410px 380px,
        370px 420px,
        340px 360px,
        440px 470px,
        360px 340px,
        420px 390px,
        380px 360px,
        400px 410px,
        430px 370px;
      background-repeat: repeat;
      background-position: 0 0, 50px 30px, 80px 60px, 120px 40px, 30px 90px, 160px 20px, 70px 150px, 200px 80px, 110px 200px, 250px 110px, 40px 160px, 180px 45px, 220px 120px, 90px 250px, 280px 180px, 130px 20px, 310px 90px, 160px 290px, 60px 225px, 330px 240px;
      animation: floatParticles1 60s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles2 73s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles3 87s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles4 67s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles5 80s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles6 63s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles7 77s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles8 70s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles9 83s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles10 90s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles11 57s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles12 93s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles13 65s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles14 78s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles15 97s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles16 68s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles17 82s cubic-bezier(0.34, 0, 0.66, 1) infinite, floatParticles18 72s cubic-bezier(0.25, 0, 0.75, 1) infinite, floatParticles19 85s cubic-bezier(0.42, 0, 0.58, 1) infinite, floatParticles20 92s cubic-bezier(0.34, 0, 0.66, 1) infinite;
    }
    .container {
      background: linear-gradient(135deg, #f5f5f5 44%, #cfcfcfff 90%, #d8d6d6ae 100%);
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 8px 20px 28px 20px;
      max-width: 442px;
      max-height: 90vh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      width: 100%;
      text-align: center;
      transition: background 0.3s ease, color 0.3s ease;
    }
    @media (max-width: 480px) {
      .container {
        max-width: calc(100% - 0px);
        max-height: 85vh;
        padding: 8px 16px 24px 16px;
      }
    }
    body.dark-mode .container {
      background: linear-gradient(135deg, #1a1a1aff 12%, #323232a4 80%, rgba(74, 74, 74, 0.45) 100%);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
      color: #e0e0e0;
    }
    .logo {
      height: 110px;
      width: auto;
      margin-bottom: 10px;
      margin-top: -1x;
      display: block;
      margin-left: auto;
      margin-right: auto;
    }
    @media (min-width: 768px) {
      .logo {
        height: 165px;
        margin-top: 0px;
        margin-bottom: 12px;
      }
    }
    h1 {
      font-size: 25px;
      color: #000000;
      font-family: 'Crafty Girls', cursive;
      font-weight: 400;
      margin-bottom: 6px;
      margin-top: 2px;
      letter-spacing: 0px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    @media (min-width: 768px) {
      h1 {
        font-size: 36px;
        margin-top: 3px;
      }
    }
    #signupSection h1 {
      font-size: 15px;
      margin-top: -4px;
    }
    @media (min-width: 768px) {
      #signupSection h1 {
        font-size: 24px;
        margin-top: -2px;
      }
    }
    .subtitle {
      color: #666;
      font-size: 11px;
      margin-bottom: 18px;
    }
    input {
      width: 100%;
      padding: 9px 11px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 13px;
      font-family: 'Poppins', sans-serif;
      transition: border-color 0.3s, background-color 0.3s, color 0.3s;
      margin-bottom: 10px;
      background: #ffffff;
      color: #000;
    }
    input:focus {
      outline: none;
      border-color: #808080;
    }
    body.dark-mode input {
      background: #2a2a2a;
      color: #e0e0e0;
      border-color: #444;
    }
    body.dark-mode input:focus {
      border-color: #666;
      background: #333;
    }
    body.dark-mode h1 {
      color: #e0e0e0;
    }
    body.dark-mode .subtitle {
      color: #b0b0b0;
    }
    body.dark-mode .title-dark-mode {
      color: #e0e0e0;
    }
    #requestAccessBtn {
      transition: all 0.3s ease;
    }
    #requestAccessBtn:hover {
      background: linear-gradient(180deg, #9a9a9a 0%, #7d7d7d 100%) !important;
      border-color: #c8c8c8 !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15) !important;
    }
    body.dark-mode #requestAccessBtn {
      background: linear-gradient(180deg, #3a3a3a 0%, #2d2d2d 100%);
      color: #e0e0e0;
      border-color: #555;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
    body.dark-mode #requestAccessBtn:hover {
      background: linear-gradient(180deg, #4d4d4d 0%, #3d3d3d 100%) !important;
      border-color: #666 !important;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5) !important;
    }
    body:not(.dark-mode) #requestAccessBtn {
      border-color: #c0c0c0 !important;
    }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #888888 0%, #666666 100%);
      color: white;
      border: none;
      border-radius: 8px;
      transition: all 0.3s ease;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      font-family: 'Poppins', sans-serif;
    }
    button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(100, 100, 100, 0.3);
    }
    button:active:not(:disabled) {
      transform: translateY(0);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    body.dark-mode button:not(:disabled) {
      background: linear-gradient(135deg, #6b6b6b 0%, #505050 100%);
      color: #ffffff;
    }
    body.dark-mode button:hover:not(:disabled) {
      box-shadow: 0 5px 12px rgba(0, 0, 0, 0.3);
    }
    .legal {
      font-size: 10px;
      color: #999;
      text-align: center;
      margin-top: 12px;
      line-height: 1.4;
    }
    .error {
      color: #d32f2f;
      font-size: 13px;
      margin-bottom: 15px;
      display: block;
    }
    body.dark-mode .error {
      color: #ff4444;
    }
    .error.hidden {
      display: none !important;
    }
    .error:not(.hidden) {
      display: block !important;
    }
    .success {
      color: #2e7d32;
      font-size: 13px;
      margin-bottom: 15px;
      display: block;
    }
    .success.hidden {
      display: none !important;
    }
    .success:not(.hidden) {
      display: block !important;
    }
    body.dark-mode .legal {
      color: #999;
    }
    body.dark-mode .timer {
      color: #b0b0b0;
    }
    body.dark-mode .social-logo {
      filter: brightness(0) saturate(100%) invert(100%) !important;
    }
    body.dark-mode .logo {
      filter: invert(100%);
    }
    body.dark-mode #landingPageLogo {
      filter: invert(100%);
    }
    body.dark-mode .modal-logo {
      filter: invert(100%);
    }
    #themeToggle {
      box-shadow: none !important;
    }
    #themeToggle:hover {
      transform: scale(1.10);
    }
    #themeToggle:focus {
      outline: none !important;
      box-shadow: none !important;
    }
    body.dark-mode #landing-best-trade {
      color: #00ff44 !important;
    }
    .section {
      display: none;
    }
    .section.active {
      display: block;
    }
    .timer {
      color: #666;
      font-size: 13px;
      margin-top: 10px;
    }
    .resend-btn {
      margin-top: 10px;
      background: #f0f0f0;
      color: #666;
      font-size: 14px;
      padding: 10px;
    }
    .resend-btn:hover:not(:disabled) {
      background: #e0e0e0;
    }
    .back-btn {
      background: linear-gradient(135deg, #888888 0%, #666666 100%);
      color: white;
      font-size: 14px;
      padding: 10px;
      margin: 0;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-family: 'Poppins', sans-serif;
      transition: all 0.3s ease;
      cursor: pointer;
    }
    .back-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(100, 100, 100, 0.3);
    }
    .back-btn:active:not(:disabled) {
      transform: translateY(0);
    }
    .signup-title {
      font-size: 30px;
      color: #000000;
      font-family: 'Poppins', sans-serif;
      font-weight: 500;
      margin-bottom: 14px;
      margin-top: -14px;
      letter-spacing: -0.6px;
    }
    button.create-account-btn {
      background: none !important;
      border: none !important;
      color: #666 !important;
      cursor: pointer !important;
      text-decoration: underline !important;
      padding: 0 !important;
      font-size: 13px !important;
      transform: none !important;
      box-shadow: none !important;
    }
    button.create-account-btn:hover:not(:disabled) {
      transform: none !important;
      box-shadow: none !important;
      color: #333 !important;
    }
    body.dark-mode button.create-account-btn {
      color: #b0b0b0 !important;
    }
    body.dark-mode button.create-account-btn:hover:not(:disabled) {
      color: #ffffff !important;
    }
    button.create-account-btn:active:not(:disabled) {
      transform: none !important;
    }
    @keyframes slideIn {
      from {
        transform: translateY(-20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    #requestAccessModal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.3);
      z-index: 99999;
      display: none;
      justify-content: center;
      align-items: center;
    }
    #requestAccessModal.show {
      display: flex;
    }
    #requestAccessModal > div {
      background: rgba(250, 250, 250, 0.98);
      border-radius: 8px;
      padding: 24px;
      max-width: 450px;
      width: 90%;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.10);
      border: 1px solid rgba(0, 0, 0, 0.08);
      animation: slideIn 0.25s ease-out;
      position: relative;
      transition: background-color 0.3s ease, border-color 0.3s ease;
    }
    body.dark-mode #requestAccessModal > div {
      background: rgba(50, 50, 50, 0.98);
      border-color: rgba(150, 150, 150, 0.2);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
    }
    body.dark-mode #requestAccessError {
      background: linear-gradient(135deg, rgba(180, 60, 60, 0.4) 0%, rgba(160, 50, 50, 0.4) 100%) !important;
      border-left-color: #ff6b6b !important;
      color: #ff9999 !important;
    }

    #statsHistoryModal {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.3);
      z-index: 99999;
      display: none;
      justify-content: center;
      align-items: center;
    }
    #statsHistoryModal.show {
      display: flex;
    }
    #statsHistoryModal > div {
      background: rgba(255, 255, 255, 0.85);
      border-radius: 12px;
      padding: 16px;
      max-width: 420px;
      width: 90%;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
      border: 1px solid rgba(0, 0, 0, 0.05);
      animation: slideIn 0.25s ease-out;
      position: relative;
      transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
      backdrop-filter: blur(10px);
    }
    body.dark-mode #statsHistoryModal > div {
      background: rgba(55, 55, 55, 0.85);
      border-color: rgba(150, 150, 150, 0.25);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    #statsHistoryModal .close-button {
      background: linear-gradient(180deg, #f0f0f0 0%, #e8e8e8 100%) !important;
      color: #666 !important;
      border: 1px solid #e0e0e0 !important;
    }
    body.dark-mode #statsHistoryModal .close-button {
      background: linear-gradient(135deg, #6b6b6b 0%, #505050 100%) !important;
      color: #e0e0e0 !important;
      border: 1px solid rgba(150, 150, 150, 0.3) !important;
    }

    .notification-list {
      padding: 0;
      margin: 0;
    }

    .notification-item {
      padding: 12px 16px;
      transition: all 0.2s ease, background-color 0.2s ease, color 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: #333;
      border-bottom: 1px solid rgba(0,0,0,0.04);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
    }
    
    .notification-item:last-child {
      border-bottom: none;
    }
    
    .notification-item:hover {
      background-color: rgba(100, 150, 255, 0.06);
    }

    body.dark-mode .notification-item:hover {
      background-color: rgba(100, 150, 255, 0.1);
    }

    body.dark-mode .notification-item {
      color: #e0e0e0;
      border-bottom-color: rgba(255, 255, 255, 0.05);
    }

    .notification-item.success .title {
      color: #666;
      font-weight: 600;
    }

    .notification-item.error .title {
      color: #666;
      font-weight: 600;
    }

    body.dark-mode .notification-item.success .title {
      color: #999;
    }

    body.dark-mode .notification-item.error .title {
      color: #999;
    }

    .notification-item .time {
      color: #999;
      font-size: 12px;
      opacity: 0.75;
    }

    body.dark-mode .notification-item .time {
      color: #999;
    }

    #statsHistoryList {
      background: rgba(0,0,0,0.01) !important;
      border-color: rgba(0,0,0,0.06) !important;
    }

    body.dark-mode #statsHistoryList {
      background: rgba(255,255,255,0.02) !important;
      border-color: rgba(255,255,255,0.08) !important;
    }

    body.dark-mode #loginStatsBox {
      background: rgba(255,255,255,0.10) !important;
      border-color: rgba(255,255,255,0.15) !important;
    }

    body.dark-mode #loginStatsBox:hover {
      background: rgba(255,255,255,0.14) !important;
      border-color: rgba(255,255,255,0.20) !important;
    }

      z-index: 100000;
    }

    @media (max-width: 768px) {
      #modalTitle {
        font-size: 14px !important;
      }
      #mainTitle {
        margin-left: -20px !important;
      }
    }

    /* Apple/Safari-specific fixes for landing page */
    @supports (-webkit-touch-callout: none) {
      .container {
        margin-top: 20px !important;
        padding: 8px 16px 24px 16px !important;
      }
      
      /* Smaller top buttons on Apple */
      [style*="position: absolute; top: 10px; left: 10px"] {
        gap: 6px !important;
      }
      
      [style*="position: absolute; top: 15px; right: 15px"] {
        gap: 8px !important;
      }
      
      /* Smaller social logos on Apple */
      .social-logo {
        height: 20px !important;
        width: 20px !important;
      }
      
      /* Move dashboard logo up 2px on Apple */
      .logo {
        margin-top: -3px !important;
      }
      
      /* Smaller Request Access button on Apple */
      #requestAccessBtn {
        padding: 6px 14px !important;
        font-size: 11px !important;
      }
      
      /* Smaller theme toggle button on Apple */
      #themeToggle {
        width: 40px !important;
        height: 40px !important;
      }
      
      #themeToggle svg {
        width: 24px !important;
        height: 24px !important;
      }
      
      /* Make logo bigger by 2% on Apple */
      #landingPageLogo {
        height: 53px !important;
      }
      
      /* Make sign-in card bigger by 2% on Apple */
      .container {
        max-width: 451px !important;
      }
      
      /* History modal less transparent on Apple */
      #statsHistoryModal {
        background: rgba(0, 0, 0, 0.75) !important;
      }
      
      body.dark-mode #statsHistoryModal {
        background: rgba(0, 0, 0, 0.82) !important;
      }
    }
  </style>
</head>
<body>
  <div class="container" id="loginContainer">
    <div style="position: absolute; top: 10px; left: 10px; display: flex; gap: 9px; align-items: center;">
      <a href="#" onclick="if(confirm('Visit the Community on Discord?')) window.open('https://discord.gg/5SQcvhfN', '_blank'); return false;" style="text-decoration: none; display: inline-flex; align-items: center; padding: 4px 4px; border-radius: 5px; transition: opacity 0.2s; cursor: pointer;" onmouseover="this.style.opacity='0.6'" onmouseout="this.style.opacity='1'"><img src="/docs/tele.png" alt="Discord" style="height: 25px; width: 24px; filter: brightness(0) saturate(100%);" class="social-logo"></a>
      <a href="#" onclick="if(confirm('Visit @cartelwrld on X?')) window.open('https://x.com/cartelwrld', '_blank'); return false;" style="text-decoration: none; display: inline-flex; align-items: center; padding: 4px 4px; border-radius: 4px; transition: opacity 0.2s; cursor: pointer;" onmouseover="this.style.opacity='0.6'" onmouseout="this.style.opacity='1'"><img src="/docs/twit.png" alt="X" style="height: 15px; width: 17px; filter: brightness(0) saturate(100%);" class="social-logo"></a>
    </div>
    <div style="position: absolute; top: 15px; right: 15px; display: flex; gap: 12px; align-items: center;">
      <button id="requestAccessBtn" onclick="document.getElementById('requestAccessModal').classList.add('show')" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; padding: 8px 18px; background: linear-gradient(180deg, #888888 0%, #666666 100%); color: white; border-radius: 6px; font-size: 12px; font-weight: 500; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; letter-spacing: 0.3px; transition: all 0.3s ease; cursor: pointer; border: 1px solid #c0c0c0; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); white-space: nowrap;">Request Access</button>
      <button id="themeToggle" onclick="toggleTheme()" style="text-decoration: none; display: inline-flex; align-items: center; justify-content: center; width: 50px; height: 50px; padding: 0; background: transparent; border: none; outline: none; cursor: pointer; transition: transform 0.3s ease;" onmouseover="this.style.transform='scale(1.10)'" onmouseout="this.style.transform='scale(1)'">
        <svg id="sunIcon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
        <svg id="moonIcon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block;">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>
    </div>
    <div style="display: flex; justify-content: center; margin-bottom: 10px; margin-top: 15px;">
      <img id="landingPageLogo" src="/docs/logo.jpeg" alt="Carlucci Capital" style="height: 52px; width: auto; object-fit: contain; opacity: 0.8; margin-right: -6px;">
    </div>
    <h1 id="mainTitle" style="color: #3a3a3a; font-size: 26px; font-family: 'Playfair Display', serif; font-weight: 500; letter-spacing: 0.4px; margin-left: -16px; margin-top: 0px; margin-bottom: 2px; transition: color 0.3s ease;">CARLUCCI CAPITAL</h1>
    <p class="subtitle" id="mainSubtitle" style="margin-top: 2px; margin-bottom: 5px; opacity: 0.55; font-size: 10px; color: #666; transition: color 0.3s ease;">Secure Access Portal</p>
    
    <div class="error" id="error"></div>
    <div class="success" id="success"></div>
    
    <!-- Email Entry Section -->
    <div class="section active" id="emailSection">
      <!-- Performance Stats Section - LOGIN PAGE ONLY -->
      <div id="loginStatsBox" onclick="openStatsHistoryModal()" style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.06); border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; font-size: 12px; display: block; cursor: pointer; transition: all 0.2s ease;" onmouseover="this.style.backgroundColor='rgba(0,0,0,0.04)'; this.style.borderColor='rgba(0,0,0,0.08)';" onmouseout="this.style.backgroundColor='rgba(0,0,0,0.02)'; this.style.borderColor='rgba(0,0,0,0.06)';">
        <div style="display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
          <div>
            <div style="opacity: 0.7; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Win Rate</div>
            <div style="font-weight: 400; font-style: italic; font-size: 14px; font-family: 'Menlo', 'Monaco', monospace;" id="landing-win-rate">-- %</div>
          </div>
          <div>
            <div style="opacity: 0.7; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Total Trades</div>
            <div style="font-weight: 400; font-style: italic; font-size: 14px; font-family: 'Menlo', 'Monaco', monospace;" id="landing-total-trades">--</div>
          </div>
          <div>
            <div style="opacity: 0.7; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Best Trade (5d)</div>
            <div style="font-weight: 400; font-style: italic; font-size: 14px; color: #2a7f3c; font-family: 'Menlo', 'Monaco', monospace;" id="landing-best-trade">--</div>
          </div>
        </div>
      </div>
      
      <input type="email" id="email" placeholder="Enter your email" autocomplete="off" style="margin-bottom: 12px;">
      <input type="password" id="password" placeholder="Enter your password" autocomplete="off" style="margin-bottom: 12px;">
      <input type="text" id="code" placeholder="Access code" autocomplete="off" style="margin-bottom: 12px;">
      <button onclick="sendCode()">Login</button>
      <div class="legal">
        This system is for authorized users only. All access is logged and monitored. By proceeding, you agree to our terms of service and acknowledge receipt of this notice. These are educational signals, not investment advice.
      </div>
      <p style="margin-top: 20px; font-size: 13px; color: #666;">
        New user? <button onclick="goToSignUp()" class="create-account-btn">Create account</button>
      </p>
    </div>
    
    <!-- Code Verification Section (REMOVED - now all on one page) -->
    <div class="section" id="verifySection" style="display: none;">
    </div>
    
    <!-- Registration Section -->
    <div class="section" id="signupSection">
      <input type="email" id="signupEmail" placeholder="Email address" autocomplete="off" style="margin-bottom: 10px;">
      <input type="password" id="signupPassword" placeholder="Password" autocomplete="off" style="margin-bottom: 10px;">
      <input type="password" id="signupConfirmPassword" placeholder="Confirm password" autocomplete="off" style="margin-bottom: 10px;">
      <input type="text" id="signupCompany" placeholder="Company (optional)" autocomplete="off" style="margin-bottom: 10px;">
      <input type="text" id="signupAccessCode" placeholder="Access code" autocomplete="off" style="margin-bottom: 16px;">
      <div style="display: flex; gap: 16px;">
        <button class="back-btn" onclick="registerUser()" style="flex: 1;">Create Account</button>
        <button class="back-btn" onclick="backToLogin()" style="flex: 1;">← Back to Login</button>
      </div>
    </div>
    
    <!-- Verify Registration Code Section (NOT USED - registration now validates access code directly) -->
    <div class="section" id="verifyRegisterSection" style="display: none;">
      <p class="subtitle" style="margin-bottom: 15px;">Code sent to <strong id="displayRegisterEmail"></strong></p>
      <p style="font-size: 12px; color: #666; margin-bottom: 15px;">Verify your email to complete registration</p>
      <input type="text" id="registerCode" placeholder="Enter 6-digit code" maxlength="6" autocomplete="off">
      <button onclick="verifyRegistrationCode()">Verify & Create Account</button>
      <div class="timer" id="registerTimer"></div>
      <button class="resend-btn" onclick="resendRegistrationCode()" id="resendRegisterBtn" disabled>Resend Code (30s)</button>
      <button class="back-btn" onclick="backToSignUp()">← Back</button>
    </div>
  </div>
  
  <script>
    let cooldownTimer = 0;
    let currentEmail = '';
    
    function toggleTheme() {
      const body = document.body;
      const sunIcon = document.getElementById('sunIcon');
      const moonIcon = document.getElementById('moonIcon');
      const themeToggle = document.getElementById('themeToggle');
      const mainTitle = document.getElementById('mainTitle');
      const mainSubtitle = document.getElementById('mainSubtitle');
      const requestAccessBtn = document.getElementById('requestAccessBtn');
      const modalTitle = document.getElementById('modalTitle');
      const modalDescription = document.getElementById('modalDescription');
      const submitRequestBtn = document.getElementById('submitRequestBtn');
      const cancelRequestBtn = document.getElementById('cancelRequestBtn');
      const statsModalTitle = document.getElementById('statsModalTitle');
      const statsModalCloseBtn = document.querySelector('#statsHistoryModal button[style*="color"]');
      const modalInputs = document.querySelectorAll('#modalContent input, #modalContent textarea');
      
      body.classList.toggle('dark-mode');
      
      if (body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark');
        sunIcon.style.display = 'block';
        sunIcon.style.stroke = '#fff';
        moonIcon.style.display = 'none';
        moonIcon.style.stroke = '#fff';
        themeToggle.style.color = '#fff';
        if (mainTitle) mainTitle.style.color = '#e0e0e0';
        if (mainSubtitle) mainSubtitle.style.color = '#b0b0b0';
        if (requestAccessBtn) {
          requestAccessBtn.style.background = 'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%)';
          requestAccessBtn.style.color = '#e0e0e0';
          requestAccessBtn.style.borderColor = '#555';
        }
        if (modalTitle) modalTitle.style.color = '#e0e0e0';
        if (modalDescription) modalDescription.style.color = '#b0b0b0';
        if (statsModalTitle) statsModalTitle.style.color = '#e0e0e0';
        if (submitRequestBtn) {
          submitRequestBtn.style.background = 'linear-gradient(180deg, #5a5a5a 0%, #424242 100%)';
          submitRequestBtn.style.color = '#ffffff';
        }
        if (cancelRequestBtn) {
          cancelRequestBtn.style.background = '#3a3a3a';
          cancelRequestBtn.style.color = '#e0e0e0';
          cancelRequestBtn.style.borderColor = '#555';
        }
        if (statsModalCloseBtn) statsModalCloseBtn.style.color = '#b0b0b0';
        modalInputs.forEach(input => {
          input.style.background = '#2a2a2a';
          input.style.color = '#e0e0e0';
          input.style.borderColor = '#444';
        });
      } else {
        localStorage.setItem('theme', 'light');
        sunIcon.style.display = 'none';
        sunIcon.style.stroke = '#333';
        moonIcon.style.display = 'block';
        moonIcon.style.stroke = '#333';
        themeToggle.style.color = '#333';
        if (mainTitle) mainTitle.style.color = '#3a3a3a';
        if (mainSubtitle) mainSubtitle.style.color = '#666';
        if (requestAccessBtn) {
          requestAccessBtn.style.background = 'linear-gradient(180deg, #888888 0%, #666666 100%)';
          requestAccessBtn.style.color = 'white';
          requestAccessBtn.style.borderColor = '#555555';
        }
        if (modalTitle) modalTitle.style.color = '#2c2c2c';
        if (modalDescription) modalDescription.style.color = '#666';
        if (statsModalTitle) statsModalTitle.style.color = '#2c2c2c';
        if (submitRequestBtn) {
          submitRequestBtn.style.background = 'linear-gradient(180deg, #888888 0%, #666666 100%)';
          submitRequestBtn.style.color = '#fff';
        }
        if (cancelRequestBtn) {
          cancelRequestBtn.style.background = '#f0f0f0';
          cancelRequestBtn.style.color = '#666';
          cancelRequestBtn.style.borderColor = '#e0e0e0';
        }
        if (statsModalCloseBtn) statsModalCloseBtn.style.color = '#666';
        modalInputs.forEach(input => {
          input.style.background = '#fff';
          input.style.color = '#000';
          input.style.borderColor = '#e0e0e0';
        });
      }
    }
    
    // Load theme on page load
    window.addEventListener('load', function() {
      const theme = localStorage.getItem('theme') || 'dark';
      const body = document.body;
      const sunIcon = document.getElementById('sunIcon');
      const moonIcon = document.getElementById('moonIcon');
      const themeToggle = document.getElementById('themeToggle');
      const mainTitle = document.getElementById('mainTitle');
      const mainSubtitle = document.getElementById('mainSubtitle');
      const requestAccessBtn = document.getElementById('requestAccessBtn');
      const modalTitle = document.getElementById('modalTitle');
      const modalDescription = document.getElementById('modalDescription');
      const submitRequestBtn = document.getElementById('submitRequestBtn');
      const cancelRequestBtn = document.getElementById('cancelRequestBtn');
      const statsModalTitle = document.getElementById('statsModalTitle');
      const statsModalCloseBtn = document.querySelector('#statsHistoryModal button[style*="color"]');
      const modalInputs = document.querySelectorAll('#modalContent input, #modalContent textarea');
      
      if (theme === 'dark') {
        body.classList.add('dark-mode');
        sunIcon.style.display = 'block';
        sunIcon.style.stroke = '#fff';
        moonIcon.style.display = 'none';
        moonIcon.style.stroke = '#fff';
        themeToggle.style.color = '#fff';
        if (mainTitle) mainTitle.style.color = '#e0e0e0';
        if (mainSubtitle) mainSubtitle.style.color = '#b0b0b0';
        if (requestAccessBtn) {
          requestAccessBtn.style.background = 'linear-gradient(180deg, #3a3a3a 0%, #2a2a2a 100%)';
          requestAccessBtn.style.color = '#e0e0e0';
          requestAccessBtn.style.borderColor = '#555';
        }
        if (modalTitle) modalTitle.style.color = '#e0e0e0';
        if (modalDescription) modalDescription.style.color = '#b0b0b0';
        if (statsModalTitle) statsModalTitle.style.color = '#e0e0e0';
        if (submitRequestBtn) {
          submitRequestBtn.style.background = 'linear-gradient(180deg, #5a5a5a 0%, #424242 100%)';
          submitRequestBtn.style.color = '#ffffff';
        }
        if (cancelRequestBtn) {
          cancelRequestBtn.style.background = '#3a3a3a';
          cancelRequestBtn.style.color = '#e0e0e0';
          cancelRequestBtn.style.borderColor = '#555';
        }
        if (statsModalCloseBtn) statsModalCloseBtn.style.color = '#b0b0b0';
        modalInputs.forEach(input => {
          input.style.background = '#2a2a2a';
          input.style.color = '#e0e0e0';
          input.style.borderColor = '#444';
        });
      } else {
        body.classList.remove('dark-mode');
        sunIcon.style.display = 'none';
        sunIcon.style.stroke = '#333';
        moonIcon.style.display = 'block';
        moonIcon.style.stroke = '#333';
        themeToggle.style.color = '#333';
        if (mainTitle) mainTitle.style.color = '#3a3a3a';
        if (mainSubtitle) mainSubtitle.style.color = '#666';
        if (requestAccessBtn) {
          requestAccessBtn.style.background = 'linear-gradient(180deg, #888888 0%, #666666 100%)';
          requestAccessBtn.style.color = 'white';
          requestAccessBtn.style.borderColor = '#555555';
        }
        if (modalTitle) modalTitle.style.color = '#2c2c2c';
        if (modalDescription) modalDescription.style.color = '#666';
        if (statsModalTitle) statsModalTitle.style.color = '#2c2c2c';
        if (submitRequestBtn) {
          submitRequestBtn.style.background = 'linear-gradient(180deg, #888888 0%, #666666 100%)';
          submitRequestBtn.style.color = '#fff';
        }
        if (cancelRequestBtn) {
          cancelRequestBtn.style.background = '#f0f0f0';
          cancelRequestBtn.style.color = '#666';
          cancelRequestBtn.style.borderColor = '#e0e0e0';
        }
        if (statsModalCloseBtn) statsModalCloseBtn.style.color = '#666';
        modalInputs.forEach(input => {
          input.style.background = '#fff';
          input.style.color = '#000';
          input.style.borderColor = '#e0e0e0';
        });
      }
    });
    
    function showErrorWithTimer(element, message, timeoutMs = 4500) {
      element.textContent = message;
      element.classList.remove('hidden');
      element.style.display = 'block';
      setTimeout(() => {
        element.classList.add('hidden');
        element.style.display = 'none';
      }, timeoutMs);
    }

    /* 
    ACCESS CODE DISTRIBUTION FLOW:
    1. Admin creates purchase codes via /admin/create-code endpoint
    2. User pays via Stripe/payment provider
    3. Payment webhook triggers code creation via API
    4. Code is emailed to user (future: via SMTP)
    5. User enters code at login - uppercased & trimmed automatically
    6. Backend validates: email + password + code must all match
    7. Session created with 1-hour expiry
    
    For now: Admin manually generates codes and shares via secure channel
    */
    
    // Load landing page performance stats
    function loadLandingPerformanceStats() {
      console.log('Loading performance stats...');
      fetch('/api/performance-summary')
        .then(r => {
          console.log('Response status:', r.status);
          return r.json();
        })
        .then(data => {
          console.log('Performance data received:', data);
          if (data && data.totalTrades > 0) {
            console.log('Setting stats - winRate:', data.winRate, 'totalTrades:', data.totalTrades);
            document.getElementById('landing-win-rate').textContent = data.winRate + '%';
            document.getElementById('landing-total-trades').textContent = data.totalTrades;
            
            if (data.bestPerformer) {
              const peak = data.bestPerformer.peak5Day;
              const direction = data.bestPerformer.direction === 'SHORT' ? '↓' : '↑';
              const tickerText = '$' + data.bestPerformer.ticker + ' ' + direction + ' ' + Math.abs(peak).toFixed(1) + '%';
              console.log('Setting best trade:', tickerText);
              document.getElementById('landing-best-trade').textContent = tickerText;
            }
          } else {
            console.log('No trade data available');
          }
        })
        .catch(err => {
          console.error('Error loading performance stats:', err);
        });
    }
    
    // Load stats when page loads
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadLandingPerformanceStats);
    } else {
      loadLandingPerformanceStats();
    }
    
    function sendCode() {
      const btn = document.querySelector('button[onclick="sendCode()"]');
      const originalText = btn.textContent;
      btn.textContent = 'Authenticating...';
      btn.disabled = true;
      
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value.trim();
      const code = document.getElementById('code').value.trim().toUpperCase();
      const error = document.getElementById('error');
      error.classList.add('hidden');
      
      // Validate email format (allow admin@cc as special case)
      const emailRegex = /^[^\s@]+@[^\s@]+(\.)?[^\s@]*$/;
      if (!email || !emailRegex.test(email)) {
        showErrorWithTimer(error, 'Please enter a valid email address');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1000);
        return;
      }
      
      if (!password) {
        showErrorWithTimer(error, 'Please enter your password');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1000);
        return;
      }
      
      if (!code) {
        showErrorWithTimer(error, 'Please enter your access code');
        setTimeout(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        }, 1000);
        return;
      }
      
      // Call verifyCode with all three values
      verifyCode(email, password, code, originalText);
    }
    
    function startCooldown() {
      cooldownTimer = 30;
      updateTimer();
      const interval = setInterval(() => {
        cooldownTimer--;
        updateTimer();
        if (cooldownTimer <= 0) {
          clearInterval(interval);
        }
      }, 1000);
    }
    
    function updateTimer() {
      const resendBtn = document.getElementById('resendBtn');
      const timer = document.getElementById('timer');
      
      if (cooldownTimer > 0) {
        resendBtn.disabled = true;
        resendBtn.textContent = \`Resend Code (\${cooldownTimer}s)\`;
        timer.textContent = \`New code available in \${cooldownTimer}s\`;
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Resend Code';
        timer.textContent = '';
      }
    }
    
    function resendCode() {
      if (cooldownTimer > 0) return;
      document.getElementById('email').value = currentEmail;
      sendCode();
    }
    
    function verifyCode(email, password, code, originalText) {
      const error = document.getElementById('error');
      const btn = document.querySelector('button[onclick="sendCode()"]');
      
      error.classList.remove('hidden');
      
      if (!code) {
        showErrorWithTimer(error, 'Please enter your access code');
        btn.textContent = originalText;
        btn.disabled = false;
        return;
      }
      
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      // Set timer to reset button after 4 seconds if no response
      const resetTimer = setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 4000);
      
      fetch('/api/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, code }),
        signal: controller.signal
      })
      .then(r => {
        clearTimeout(timeoutId);
        clearTimeout(resetTimer);
        if (!r.ok) throw new Error('Request failed: ' + r.status);
        return r.json();
      })
      .then(data => {
        clearTimeout(resetTimer);
        if (btn) {
          btn.textContent = originalText;
          btn.disabled = false;
        }
        
        if (data.success) {
          window.location.href = '/';
        } else {
          showErrorWithTimer(error, data.error || 'Invalid credentials or code');
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        clearTimeout(resetTimer);
        if (btn) {
          btn.textContent = originalText;
          btn.disabled = false;
        }
        
        showErrorWithTimer(error, 'Invalid credentials or code');
      });
    }
    
    function goBack() {
      document.getElementById('verifySection').classList.remove('active');
      document.getElementById('emailSection').classList.add('active');
      document.getElementById('code').value = '';
      document.getElementById('error').style.display = 'none';
      document.getElementById('success').style.display = 'none';
    }
    
    function goToSignUp() {
      document.getElementById('emailSection').classList.remove('active');
      document.getElementById('signupSection').classList.add('active');
      document.getElementById('pageTitle').textContent = 'Create Account';
      document.querySelector('.subtitle').style.display = 'none';
      const error = document.getElementById('error');
      const success = document.getElementById('success');
      error.textContent = '';
      error.style.display = 'none';
      success.textContent = '';
      success.style.display = 'none';
    }
    
    function backToLogin() {
      document.getElementById('signupSection').classList.remove('active');
      document.getElementById('emailSection').classList.add('active');
      document.getElementById('pageTitle').textContent = "Carlucci Capital";
      document.querySelector('.subtitle').style.display = 'block';
      const error = document.getElementById('error');
      const success = document.getElementById('success');
      error.textContent = '';
      error.style.display = 'none';
      success.textContent = '';
      success.style.display = 'none';
      document.getElementById('signupEmail').value = '';
      document.getElementById('signupPassword').value = '';
      document.getElementById('signupFullName').value = '';
      document.getElementById('signupCompany').value = '';
    }
    
    function backToSignUp() {
      document.getElementById('verifyRegisterSection').classList.remove('active');
      document.getElementById('signupSection').classList.add('active');
      document.getElementById('pageTitle').textContent = 'Create Account';
      document.querySelector('.subtitle').style.display = 'none';
      const error = document.getElementById('error');
      const success = document.getElementById('success');
      error.textContent = '';
      error.classList.add('hidden');
      success.textContent = '';
      success.classList.add('hidden');
      document.getElementById('registerCode').value = '';
    }
    
    function registerUser() {
      const email = document.getElementById('signupEmail').value.trim();
      const password = document.getElementById('signupPassword').value.trim();
      const confirmPassword = document.getElementById('signupConfirmPassword').value.trim();
      const company = document.getElementById('signupCompany').value.trim();
      const accessCode = document.getElementById('signupAccessCode').value.trim();
      const error = document.getElementById('error');
      const success = document.getElementById('success');
      
      error.classList.add('hidden');
      success.classList.add('hidden');
      
      // Validate inputs (allow admin@cc as special case)
      const emailRegex = /^[^\s@]+@[^\s@]+(\.)?[^\s@]*$/;
      if (!email || !emailRegex.test(email)) {
        showErrorWithTimer(error, 'Please enter a valid email address');
        return;
      }
      
      if (!password || password.length < 6) {
        showErrorWithTimer(error, 'Password must be at least 6 characters');
        return;
      }
      
      if (password !== confirmPassword) {
        showErrorWithTimer(error, 'Passwords do not match');
        return;
      }
      
      if (!accessCode) {
        showErrorWithTimer(error, 'Please enter your access code');
        return;
      }
      
      const btn = document.querySelector('button[onclick="registerUser()"]');
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'not-allowed';
      const originalText = btn.textContent;
      btn.textContent = 'Creating...';
      
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      fetch('/api/auth-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName, company, accessCode }),
        signal: controller.signal
      })
      .then(r => {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('Request failed: ' + r.status);
        return r.json();
      })
      .then(data => {
        if (data.success) {
          // Registration successful, auto-login
          window.location.href = '/';
        } else {
          showErrorWithTimer(error, data.error || 'Registration failed');
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          btn.textContent = originalText;
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        
        let errorMsg = 'Error: ' + err.message;
        if (err.name === 'AbortError') {
          errorMsg = 'Request timed out. Please try again.';
        } else if (err.message.includes('Failed')) {
          errorMsg = 'Registration failed. Please check your information.';
        }
        
        showErrorWithTimer(error, errorMsg);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.textContent = originalText;
      });
    }
    
    function startRegisterCooldown() {
      cooldownTimer = 30;
      updateRegisterTimer();
      const interval = setInterval(() => {
        cooldownTimer--;
        updateRegisterTimer();
        if (cooldownTimer <= 0) {
          clearInterval(interval);
          document.getElementById('resendRegisterBtn').disabled = false;
        }
      }, 1000);
    }
    
    function updateRegisterTimer() {
      const timerEl = document.getElementById('registerTimer');
      if (cooldownTimer > 0) {
        document.getElementById('resendRegisterBtn').textContent = \`Resend Code (\${cooldownTimer}s)\`;
        document.getElementById('resendRegisterBtn').disabled = true;
      } else {
        document.getElementById('resendRegisterBtn').textContent = 'Resend Code';
        document.getElementById('resendRegisterBtn').disabled = false;
      }
    }
    
    function resendRegistrationCode() {
      const email = document.getElementById('signupEmail').value.trim();
      fetch('/api/auth-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resend: true })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          startRegisterCooldown();
          document.getElementById('success').textContent = 'Code resent! Check your email.';
          document.getElementById('success').style.display = 'block';
        } else {
          document.getElementById('error').textContent = data.error || 'Failed to resend code';
          document.getElementById('error').style.display = 'block';
        }
      });
    }
    
    function verifyRegistrationCode() {
      const email = document.getElementById('signupEmail').value.trim();
      const code = document.getElementById('registerCode').value.trim();
      const password = document.getElementById('signupPassword').value.trim();
      const fullName = document.getElementById('signupFullName').value.trim();
      const company = document.getElementById('signupCompany').value.trim() || '';
      const error = document.getElementById('error');
      
      error.style.display = 'none';
      
      if (!code || code.length !== 6) {
        error.textContent = 'Please enter the 6-character code';
        error.style.display = 'block';
        return;
      }
      
      const btn = document.querySelector('button[onclick="verifyRegistrationCode()"]');
      btn.disabled = true;
      btn.style.opacity = '0.7';
      const originalText = btn.textContent;
      btn.textContent = 'Verifying...';
      
      // Create an AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      fetch('/api/auth-verify-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password, fullName, company }),
        signal: controller.signal
      })
      .then(r => {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error('Request failed: ' + r.status);
        return r.json();
      })
      .then(data => {
        if (data.success) {
          window.location.href = '/';
        } else {
          error.textContent = data.error || 'Verification failed';
          error.style.display = 'block';
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.textContent = originalText;
        }
      })
      .catch(err => {
        clearTimeout(timeoutId);
        
        let errorMsg = 'Error: ' + err.message;
        if (err.name === 'AbortError') {
          errorMsg = 'Request timed out. Please try again.';
        } else if (err.message.includes('Failed')) {
          errorMsg = 'Verification failed. Please check your code.';
        }
        
        error.textContent = errorMsg;
        error.style.display = 'block';
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = originalText;
      });
    }
    
    document.getElementById('email').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendCode();
    });
    
    document.getElementById('code').addEventListener('keypress', e => {
      if (e.key === 'Enter') sendCode();
    });
    
    document.getElementById('signupEmail').addEventListener('keypress', e => {
      if (e.key === 'Enter') registerUser();
    });
    
    document.getElementById('registerCode').addEventListener('keypress', e => {
      if (e.key === 'Enter') verifyRegistrationCode();
    });
  </script>
  </div>
  <!-- Request Access Modal - OUTSIDE container for proper fixed positioning -->
  <div id="requestAccessModal">
    <div id="modalContent">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <img src="/logo.jpeg" alt="Carlucci Capital" class="modal-logo" style="height: 35px; width: auto; opacity: 0.8;">
        <h2 id="modalTitle" style="font-size: 18px; color: #2c2c2c; margin: 0; font-family: 'Poppins', sans-serif; font-weight: 600; transition: color 0.3s ease;">Membership Access</h2>
      </div>
      <p id="modalDescription" style="color: #666; font-size: 13px; margin-bottom: 20px; font-family: 'Poppins', sans-serif; transition: color 0.3s ease;">Submit your information and we'll review your application within 24 hours.</p>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <input type="text" id="requestAccessName" placeholder="Full Name" style="padding: 11px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 13px; font-family: 'Poppins', sans-serif; transition: border-color 0.3s, background-color 0.3s, color 0.3s; background: #fff; color: #000;">
        <input type="email" id="requestAccessEmail" placeholder="Email Address" style="padding: 11px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 13px; font-family: 'Poppins', sans-serif; transition: border-color 0.3s, background-color 0.3s, color 0.3s; background: #fff; color: #000;">
        <input type="text" id="requestAccessSource" placeholder="Where did you hear about us? (optional)" style="padding: 11px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 13px; font-family: 'Poppins', sans-serif; transition: border-color 0.3s, background-color 0.3s, color 0.3s; background: #fff; color: #000;">
        <textarea id="requestAccessMessage" placeholder="Please describe your investment background and intended use case" style="padding: 11px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 13px; font-family: 'Poppins', sans-serif; min-height: 100px; resize: vertical; transition: border-color 0.3s, background-color 0.3s, color 0.3s; background: #fff; color: #000;"></textarea>
        <div id="requestAccessError" style="background: linear-gradient(135deg, #fee 0%, #fdd 100%); border-left: 4px solid #d32f2f; color: #c62828; font-size: 13px; display: none; padding: 11px 11px; border-radius: 5px; margin: 0 0 4px 0; font-weight: 500; width: 100%; box-sizing: border-box; box-shadow: 0 2px 8px rgba(211, 47, 47, 0.1); animation: slideIn 0.3s ease-out;"></div>
        <div id="requestAccessSuccess" style="color: #2e7d32; font-size: 12px; display: none; padding: 8px 12px; background: #e8f5e9; border-radius: 4px; margin-bottom: 8px; border: 1px solid #66bb6a;"></div>
        <div style="display: flex; gap: 12px; margin-top: 8px;">
          <button id="submitRequestBtn" type="button" onclick="submitAccessRequest()" style="flex: 1; padding: 12px; background: linear-gradient(180deg, #888888 0%, #666666 100%); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif; transition: transform 0.2s, box-shadow 0.2s, background 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">Submit Request</button>
          <button id="cancelRequestBtn" type="button" onclick="document.getElementById('requestAccessModal').classList.remove('show')" style="flex: 1; padding: 12px; background: #f0f0f0; color: #666; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif; transition: background-color 0.2s, color 0.3s ease, border-color 0.3s ease;">Cancel</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Stats History Modal -->
  <div id="statsHistoryModal">
    <div id="statsModalContent">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 id="statsModalTitle" style="font-size: 16px; color: #2c2c2c; margin: 0; font-family: 'Poppins', sans-serif; font-weight: 600; transition: color 0.3s ease;">Recent History</h2>
      </div>
      <div id="statsHistoryList" style="max-height: 300px; overflow-y: auto; border: none; border-radius: 8px; margin-bottom: 12px; background: transparent;"></div>
      <div style="display: flex; gap: 12px;">
        <button class="close-button" onclick="document.getElementById('statsHistoryModal').classList.remove('show')" style="flex: 1; padding: 12px; background: #f0f0f0; color: #666; border: 1px solid #e0e0e0; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif; transition: background-color 0.2s, color 0.3s ease, border-color 0.3s ease;">Close</button>
      </div>
    </div>
  </div>
  
  <script>
    function updateSocialLogoDarkMode() {
      const logos = document.querySelectorAll('.social-logo');
      const isDarkMode = document.body.classList.contains('dark-mode');
      logos.forEach(logo => {
        if (isDarkMode) {
          logo.style.filter = 'brightness(0) saturate(100%) invert(100%)';
        } else {
          logo.style.filter = 'brightness(0) saturate(100%)';
        }
      });
    }
    updateSocialLogoDarkMode();
    const observer = new MutationObserver(() => updateSocialLogoDarkMode());
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    
    function customConfirm(message, url) {
      if (confirm(message)) {
        window.open(url, '_blank');
      }
    }

    function openStatsHistoryModal() {
      const modal = document.getElementById('statsHistoryModal');
      if (!modal) {
        console.error('Stats history modal element not found');
        return;
      }
      modal.classList.add('show');
      populateStatsHistory();
    }

    function populateStatsHistory() {
      const listContainer = document.getElementById('statsHistoryList');
      if (!listContainer) return;

      // Helper function to safely parse JSON with retry logic
      const safeJsonFetch = (url) => {
        return fetch(url)
          .then(r => r.text())
          .then(text => {
            if (!text || text.trim().length === 0) {
              return {};
            }
            try {
              return JSON.parse(text);
            } catch (e) {
              console.warn('Failed to parse', url, '- returning empty object');
              return {};
            }
          })
          .catch(err => {
            console.warn('Failed to fetch', url, '- returning empty object');
            return {};
          });
      };

      // Fetch both stocks.json (for alert info) and quote.json (for live performance)
      Promise.all([
        safeJsonFetch('/logs/stocks.json'),
        safeJsonFetch('/logs/quote.json')
      ])
        .then(([stocks, quotes]) => {
          // Ensure stocks is an array
          if (!Array.isArray(stocks)) {
            stocks = [];
          }
          if (!quotes || typeof quotes !== 'object') {
            quotes = {};
          }

          console.log('Stocks array length:', stocks.length);
          console.log('Quotes tickers:', Object.keys(quotes).length);
          
          if (!Array.isArray(stocks) || stocks.length === 0) {
            listContainer.innerHTML = '<div class="notification-list"><div style="padding: 16px; text-align: center; color: #999;">No trade history available</div></div>';
            return;
          }

          // Show all trades (most recent first) - reverse array for newest at bottom
          const recentTrades = stocks.slice().reverse();
          let html = '<div class="notification-list">';
          
          recentTrades.forEach(trade => {
            const direction = trade.direction === 'SHORT' ? 'SHORT' : 'LONG';
            const alertPrice = trade.price ? '$' + parseFloat(trade.price).toFixed(4) : 'N/A';
            
            // Get peak data and calculate percentage
            const quoteData = quotes && quotes[trade.ticker] ? quotes[trade.ticker] : null;
            let peakPrice = 'N/A';
            let peakChange = '0';
            
            if (direction === 'SHORT') {
              // For SHORT: peak is when price goes DOWN (lowest price)
              // Use quote.json lowest as it has live data
              const lowest = quoteData?.lowest || trade.lowest5Day || trade.price;
              if (lowest && lowest > 0 && trade.price > 0) {
                peakPrice = '$' + parseFloat(lowest).toFixed(4);
                peakChange = ((lowest - trade.price) / trade.price * 100).toFixed(1);
              }
            } else {
              // For LONG: peak is when price goes UP (highest price)
              // Use quote.json highest as it has live data
              const highest = quoteData?.highest || trade.highest5Day || trade.price;
              if (highest && highest > 0 && trade.price > 0) {
                peakPrice = '$' + parseFloat(highest).toFixed(4);
                peakChange = ((highest - trade.price) / trade.price * 100).toFixed(1);
              }
            }
            
            // Determine if trade was a win: SHORT with negative change, LONG with positive change
            const isWin = (direction === 'SHORT' && peakChange < 0) || (direction !== 'SHORT' && peakChange > 0);
            const isDarkMode = document.body.classList.contains('dark-mode');
            const percentColor = isWin ? (isDarkMode ? '#00ff00' : '#2a7f3c') : (isDarkMode ? '#ff0000' : '#c23b3b');
            
            const tickerColor = document.body.classList.contains('dark-mode') ? '#ccc' : '#666';
            let filingDateTime = 'N/A';
            if (trade.recordedAt) {
              const date = new Date(trade.recordedAt);
              const dateStr = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
              const timeStr = date.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit' });
              filingDateTime = dateStr + ' ' + timeStr + ' UTC';
            }
            html += '<div class="notification-item">' +
              '<div class="title" style="font-weight: 600; font-size: 13px; color: ' + tickerColor + ';">$' + trade.ticker + ' / <i>' + direction + '</i></div>' +
              '<div style="font-size: 11px; opacity: 0.8; margin: 4px 0;">' +
              '<span>Alert: ' + alertPrice + ' → Peak: ' + peakPrice + ' <b><i style="color: ' + percentColor + ';">(' + peakChange + '%)</i></b></span>' +
              '</div>' +
              '<div class="time" style="font-size: 10px; margin-top: 4px;">' + filingDateTime + ' | ' + trade.companyName + '</div>' +
              '</div>';
          });
          html += '</div>';
          listContainer.innerHTML = html;
        })
        .catch(err => {
          console.error('Error loading trade history:', err);
          listContainer.innerHTML = '<div class="notification-list"><div style="padding: 16px; text-align: center; color: #999;">Error: ' + err.message + '</div></div>';
        });
    }
        
    function openRequestAccessModal() {
      const modal = document.getElementById('requestAccessModal');
      if (!modal) {
        console.error('Modal element not found');
        return;
      }
      modal.classList.add('show');
      setTimeout(() => {
        const nameInput = document.getElementById('requestAccessName');
        if (nameInput) nameInput.focus();
      }, 50);
      document.getElementById('requestAccessError').style.display = 'none';
      document.getElementById('requestAccessSuccess').style.display = 'none';
    }
    
    async function submitAccessRequest() {
      const name = document.getElementById('requestAccessName').value.trim();
      const email = document.getElementById('requestAccessEmail').value.trim();
      const message = document.getElementById('requestAccessMessage').value.trim();
      const errorDiv = document.getElementById('requestAccessError');
      
      // Validation
      if (!name || !email || !message) {
        if (errorDiv) {
          errorDiv.textContent = 'Please fill in all required fields';
          errorDiv.style.display = 'block';
        }
        return;
      }
      
      // Email validation - permissive regex that accepts valid email formats
      const emailRegex = /^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        if (errorDiv) {
          errorDiv.textContent = 'Please enter a valid email address';
          errorDiv.style.display = 'block';
        }
        return;
      }
      
      // Show confirmation
      if (!confirm('Submit access request for ' + email + '?')) {
        return;
      }
      
      try {
        console.log('Sending request with:', { name, email, message });
        const response = await fetch('/api/send-access-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message })
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
          console.error('Response not ok:', response.statusText);
          throw new Error('Request failed with status ' + response.status);
        }
        
        const data = await response.json();
        console.log('Response data:', data);
        
        if (data.success) {
          alert('Request submitted successfully! We will review and contact you soon.');
          closeRequestAccessModal();
        } else {
          if (errorDiv) {
            errorDiv.textContent = data.error || 'Failed to submit request';
            errorDiv.style.display = 'block';
          }
        }
      } catch (err) {
        console.error('Fetch error:', err);
        if (errorDiv) {
          errorDiv.textContent = 'Network error. Please try again.';
          errorDiv.style.display = 'block';
        }
      }
    }
    
    function closeRequestAccessModal() {
      const modal = document.getElementById('requestAccessModal');
      if (modal) {
        modal.classList.remove('show');
      }
      // Clear form fields
      document.getElementById('requestAccessName').value = '';
      document.getElementById('requestAccessEmail').value = '';
      document.getElementById('requestAccessMessage').value = '';
      document.getElementById('requestAccessError').style.display = 'none';
    }
    
    // Close modal when clicking outside of it
    const requestAccessModal = document.getElementById('requestAccessModal');
    if (requestAccessModal) {
      requestAccessModal.addEventListener('click', function(e) {
        if (e.target === this || e.target.id === 'requestAccessModal') {
          closeRequestAccessModal();
        }
      });
    }
    
    // Allow ESC key to close modal
    document.addEventListener('keydown', function(e) {
      const modal = document.getElementById('requestAccessModal');
      if (modal && e.key === 'Escape' && modal.classList.contains('show')) {
        closeRequestAccessModal();
      }
    });
  </script>
</body>
</html>
`;

// Send OTP email
const MAILTRAP_API_TOKEN = process.env.MAILTRAP_API_TOKEN || '';

// Note: emailTransporter is already initialized above in the email setup section

const sendMailtrapEmail = async (to, subject, html) => {
  if (!emailTransporter) {
    log('WARN', `Email transporter not available for ${to}`);
    return false;
  }
  
  try {
    const info = await emailTransporter.sendMail({
      from: CONFIG.EMAIL_FROM || 'noreply@eugenes.shop',
      to: to,
      subject: subject,
      html: html
    });
    log('INFO', `Email sent successfully to ${to}`);
    return true;
  } catch (err) {
    log('ERROR', `Failed to send email to ${to}: ${err.message}`);
    return false;
  }
};

const sendOTPEmail = async (email, otp) => {
  const html = `
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <div style="max-width: 600px; margin: 0 auto;">
    <h2 style="color: #667eea; font-family: 'El Messiri', serif;">Carlucci Capital</h2>
    <p>You requested access to the Carlucci Capital portal.</p>
    <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
      <p style="font-size: 12px; color: #999;">Your access code:</p>
      <p style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 4px;">${otp}</p>
    </div>
    <p style="font-size: 13px; color: #666;">This code will expire in 15 minutes. It can only be used once and is tied to your email address.</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="font-size: 11px; color: #999;">If you did not request this access, please ignore this email. Do not share this code with anyone.</p>
  </div>
</body>
</html>
  `;

  const success = await sendMailtrapEmail(email, 'Your Portal Access Code', html);
  log('AUTH', `OTP for ${email.toLowerCase()}: ${otp}`);
  return success;
};

const parseCookies = (cookieHeader = '') => {

  const cookies = {};

  cookieHeader.split(';').forEach(part => {
    const [rawKey, rawVal] = part.split('=');
    if (!rawKey || !rawVal) return;
    const key = rawKey.trim();
    const val = rawVal.trim();
    if (!key || !val) return;
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  });
  return cookies;
};

const getClientMetadata = (req) => {
  const ip = (req.headers['cf-connecting-ip']
    || (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null)
    || req.socket?.remoteAddress
    || req.ip
    || 'Unknown');

  const country = req.headers['cf-ipcountry'] || 'Unknown';
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const method = req.method;
  const path = req.originalUrl || req.url || '';

  return {
    ip,
    country,
    userAgent,
    method,
    path,
    time: new Date().toISOString(),
    headers: {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'cf-ipcountry': req.headers['cf-ipcountry'],
      'user-agent': userAgent,
      host: req.headers['host'],
      referer: req.headers['referer'] || req.headers['referrer'],
    },
  };
};

const SECURITY_LOG_FILE = 'logs/opsec.json';
const DATA_LOG_FILE = 'logs/data.json';

// Simple login data logger - tracks all login attempts and personal details
const logLoginAttempt = (email, password, code, ip, fingerprint, userAgent, success, reason = '', fullName = '', company = '') => {
  try {
    const dataLogPath = DATA_LOG_FILE;
    let logs = [];
    
    if (fs.existsSync(dataLogPath)) {
      try {
        const raw = fs.readFileSync(dataLogPath, 'utf8').trim();
        if (raw) logs = JSON.parse(raw);
      } catch (e) {
        logs = [];
      }
    }
    
    logs.push({
      timestamp: new Date().toISOString(),
      email: email,
      fullName: fullName || 'N/A',
      company: company || 'N/A',
      password: password, // Saved for audit
      code: code || 'N/A',
      ip: ip,
      fingerprint: fingerprint,
      userAgent: userAgent,
      success: success,
      reason: reason
    });
    
    // Keep only last 1000 entries to avoid massive file
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }
    
    fs.writeFileSync(dataLogPath, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error('Error logging login attempt:', err);
  }
};

// Enhanced security logging with geolocation, device fingerprinting, and behavioral analysis
const getClientFingerprint = (req) => {
  const crypto = require('crypto');
  const fingerprint = `${req.ip}-${req.get('user-agent')}-${req.get('accept-language')}-${req.get('accept-encoding')}`;
  return crypto.createHash('sha256').update(fingerprint).digest('hex').substring(0, 16);
};

const extractDeviceInfo = (userAgent) => {
  const ua = userAgent || '';
  const isMobile = /mobile|android|iphone|ipad/i.test(ua);
  const isBot = /bot|crawler|spider|scraper|curl|wget/i.test(ua);
  
  let browser = 'Unknown';
  let os = 'Unknown';
  
  if (ua.includes('Chrome')) browser = 'Chrome';
  else if (ua.includes('Safari')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edge')) browser = 'Edge';
  
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone')) os = 'iOS';
  
  return { isMobile, isBot, browser, os };
};

const detectVPNProxy = (ip) => {
  // Common datacenter/VPN IP ranges (simplified - in production use MaxMind GeoIP2)
  const suspiciousPatterns = [
    /^192\./, // Private range
    /^10\./, // Private range
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // Private range
    /^127\./, // Loopback
  ];
  return suspiciousPatterns.some(pattern => pattern.test(ip));
};

const calculateSuspicionScore = (authData) => {
  let score = 0;
  
  // Bot detection (high weight)
  if (authData.deviceInfo?.isBot) score += 0.4;
  
  // VPN/Proxy usage
  if (authData.isVpn) score += 0.2;
  
  // Unusual country (if not previously seen)
  if (authData.countryChange) score += 0.15;
  
  // Mobile access (lower risk but unusual for admin)
  if (authData.deviceInfo?.isMobile) score += 0.1;
  
  // Rapid consecutive attempts
  if (authData.failedAttempts > 2) score += Math.min(0.3, authData.failedAttempts * 0.05);
  
  // Off-hours access (bonus detection if enabled)
  const hour = new Date().getHours();
  if (hour < 6 || hour > 22) score += 0.05;
  
  return Math.min(score, 1.0);
};

const analyzeTraffic = (req, sessionId) => {
  const now = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const fingerprint = getClientFingerprint(req);
  const deviceInfo = extractDeviceInfo(req.get('user-agent'));
  const isVpn = detectVPNProxy(ip);
  
  let existingLogins = [];
  try {
    if (fs.existsSync(SECURITY_LOG_FILE)) {
      const raw = fs.readFileSync(SECURITY_LOG_FILE, 'utf8').trim();
      if (raw) existingLogins = JSON.parse(raw) || [];
    }
  } catch (e) {}
  
  // Analyze patterns
  const recentLogins = existingLogins.filter(l => {
    const loginTime = new Date(l.createdAt || l.approvedAt);
    const minsAgo = (new Date() - loginTime) / 60000;
    return minsAgo < 1440; // Last 24 hours
  });
  
  const fromSameIP = recentLogins.filter(l => l.ip === ip).length;
  const fromDifferentCountries = new Set(recentLogins.map(l => l.country)).size > 1;
  const fromDifferentDevices = new Set(recentLogins.map(l => l.fingerprint)).size > 1;
  const failedAttempts = recentLogins.filter(l => l.decision === 'denied').length;
  
  const suspicionScore = calculateSuspicionScore({
    deviceInfo,
    isVpn,
    countryChange: fromDifferentCountries && fromSameIP === 0,
    failedAttempts
  });
  
  const authData = {
    timestamp: now,
    sessionId,
    ip,
    fingerprint,
    deviceInfo,
    security: {
      vpn_or_proxy: isVpn,
      suspicion_score: parseFloat(suspicionScore.toFixed(2)),
      failed_attempts_24h: failedAttempts,
      country_changes_24h: fromDifferentCountries ? 'yes' : 'no',
      device_diversity_24h: fromDifferentDevices ? 'yes' : 'no',
      logins_from_this_ip_24h: fromSameIP
    },
    request: {
      method: req.method,
      path: req.path,
      userAgent: req.get('user-agent'),
      acceptLanguage: req.get('accept-language'),
      referer: req.get('referer') || 'direct',
      xForwardedFor: req.get('x-forwarded-for'),
      origin: req.get('origin'),
      timestamp: now
    },
    threat_level: suspicionScore > 0.7 ? 'HIGH' : suspicionScore > 0.4 ? 'MEDIUM' : 'LOW',
    contractAgreements: {
      ...getContractTemplate(),
      userIdentification: {
        sessionId,
        deviceFingerprint: fingerprint,
        ipAddress: ip.replace('::ffff:', ''),
        browserUserAgent: req.get('user-agent'),
        timestamp: now,
        note: 'These identifiers uniquely establish user identity for contract enforcement and legal proceedings'
      }
    },
    contractHash: generateContractHash(fingerprint, getContractTemplate())
  };
  
  // Log to security log file (consolidated auth + traffic data)
  try {
    let securityLog = [];
    if (fs.existsSync(SECURITY_LOG_FILE)) {
      const raw = fs.readFileSync(SECURITY_LOG_FILE, 'utf8').trim();
      if (raw) securityLog = JSON.parse(raw) || [];
    }
    // Always log security data - it's being passed a sessionId so always valid
    if (sessionId) {
      securityLog.push(authData);
      if (securityLog.length > 500) securityLog = securityLog.slice(-500);
      fs.writeFileSync(SECURITY_LOG_FILE, JSON.stringify(securityLog, null, 2));
    }
  } catch (err) {
    // Silent fail on security logging
  }
  
  return authData;
};

const appendSecurityLog = (entry) => {
  try {
    let existing = [];
    if (fs.existsSync(SECURITY_LOG_FILE)) {
      const raw = fs.readFileSync(SECURITY_LOG_FILE, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        existing = Array.isArray(parsed) ? parsed : [];
      }
    }
    existing.push(entry);
    // Keep file from growing forever - last 500 entries
    if (existing.length > 500) {
      existing = existing.slice(-500);
    }
    fs.writeFileSync(SECURITY_LOG_FILE, JSON.stringify(existing, null, 2));
  } catch (err) {
    log('WARN', `Failed to write security log: ${err.message}`);
  }
};

// Return full contract agreement for all sessions - Trade Secret + Black's Law enforcement
// This contract incorporates all 10 gaps for 100% enforceability
const getContractTemplate = () => {
  return {
    version: '1.0',
    jurisdiction: 'Delaware law governs; DTSA applies federally; user retains consumer protection rights in home state',
    
    // CRITICAL: Delaware UTSA statutory incorporation (upgraded from generic jurisdiction)
    delawareUTSA: {
      statute: 'Delaware Code Title 6, Chapter 20 (Uniform Trade Secrets Act)',
      venue: 'Court of Chancery of the State of Delaware',
      choiceOfLaw: 'Delaware law without regard to conflict of law principles',
      delaware20106: 'Trade secret definition: "information that derives independent economic value from not being generally known and is subject to reasonable efforts to maintain its secrecy"',
      delaware20107: 'Reasonable efforts standard: Operator maintains multi-factor authentication, device fingerprinting, audit trails, encryption, and access controls meeting or exceeding industry standards',
      damages: 'Treble damages available under UTSA for willful/malicious misappropriation',
      attorneyFees: 'Prevailing party recovers all attorney fees and costs'
    },
    
    // CRITICAL: DTSA statutory whistleblower immunity notice (required for enforcement validity)
    dtsaWhistleblowerNotice: {
      statutoryRequirement: '18 U.S.C. § 1833(b)(3)(B) - NOTICE REQUIRED FOR ENFORCEMENT',
      immunity: 'An individual shall not be held criminally or civilly liable under any Federal or State trade secret law for disclosure of a trade secret made in confidence to a government official or attorney solely for reporting/investigating suspected violation of law',
      immunityCondition: 'Disclosure must be: (A) in confidence; (B) to government official or attorney; (C) solely for reporting/investigating suspected violation',
      implication: 'User cannot be prosecuted for reporting illegal activity. This notice is required by statute and does not waive the confidentiality obligations herein.',
      conspicuousNotice: '*** IMPORTANT: Federal law provides whistleblower protections for disclosure of trade secrets in connection with reporting potential illegal conduct. See 18 U.S.C. § 1833(b). ***'
    },
    
    // CRITICAL: Personal jurisdiction consent clause (prevents international jurisdictional challenges)
    personalJurisdiction: {
      consentToJurisdiction: 'User CONSENTS to personal jurisdiction in Delaware for any dispute arising from this agreement',
      agentForService: 'User appoints Delaware Secretary of State as agent for service of process for any legal action related to this agreement',
      waiver: 'User WAIVES all objections to venue, jurisdiction, personal jurisdiction, and "inconvenient forum" defenses',
      effectivity: 'This consent is irrevocable and survives termination of all other terms'
    },
    
    // CRITICAL: JAMS mandatory arbitration clause (faster, cheaper, more private than court)
    mandatoryArbitration: {
      mechanism: 'All disputes arising from or relating to this agreement shall be resolved through binding arbitration',
      forum: 'JAMS (Judicial Arbitration and Mediation Services) Comprehensive Arbitration Rules',
      location: 'Wilmington, Delaware',
      arbitratorPanel: 'Three-arbitrator panel (or single arbitrator if claim <$250k)',
      selection: 'Arbitrators selected from JAMS retired judges and experienced trade secret law specialists',
      rulesApplied: 'JAMS rules with expedited discovery for trade secret cases',
      evidenceStandard: 'Delaware evidence rules and DTSA case law apply',
      discoveryExpedited: 'Full discovery available but expedited procedures apply',
      confidentiality: 'All arbitration proceedings are strictly confidential - no public record',
      feeShifting: 'Losing party pays all arbitration costs including arbitrators\' fees, JAMS administrative costs, discovery costs',
      attorneyFees: 'Prevailing party recovers ALL reasonable attorney fees and costs',
      appeal: 'No appeal except for manifest disregard of law or fraud in arbitration process',
      forumSelection: 'User waives right to court litigation and accepts binding arbitration as exclusive remedy'
    },
    
    // CRITICAL: PepsiCo inevitable disclosure doctrine (prevents competitive employment)
    inevitableDisclosure: {
      doctrine: 'PepsiCo, Inc. v. Redmond, 54 F.3d 1262 (7th Cir. 1995) - If user accepts employment with direct competitor, trade secrets will inevitably be disclosed',
      prohibition: 'User AGREES to 12-month post-termination injunction prohibiting employment with direct competitors in quant trading, algorithmic analysis, or signal generation',
      definition: 'Direct competitor defined as: (A) Any firm providing trade signal algorithms; (B) Any fund using pattern recognition for trading; (C) Any service offering proprietary quote analysis',
      scope: 'Injunction applies globally for 12 months after termination',
      exceptions: 'User may work for competitor only if: (A) Operator provides written consent; (B) User accepts monitoring of work; (C) User demonstrates compartmentalization',
      consideration: 'User acknowledges this injunction is reasonable in light of the proprietary information provided and the competitive advantage at stake'
    },
    
    scope: 'PROTECTION OF PROPRIETARY TRADING METHODOLOGY AND CLASSIFIED QUOTE DATA',
    incorporationByReference: 'All terms governed by Black\'s Law Dictionary, 11th Edition. Trade secret (UTSA/DTSA), quasi-contract, tortious interference, unjust enrichment doctrines expressly incorporated.',
    
    // Gap #4: Explicit consideration statement
    consideration: {
      operatorProvides: 'Exclusive access to proprietary real-time quote analysis, signal scores, timing models, enriched datasets not available elsewhere in market; technical support; continuous methodology development',
      userCommits: 'Maintains strict confidentiality of all proprietary methodology and derived data; does not reverse engineer, redistribute, or create derivatives; acknowledges trade secret status; submits to device-based binding',
      legalBasis: 'This mutual exchange of valuable benefits constitutes valid consideration making agreement binding and enforceable'
    },
    
    termOfService: {
      version: '3.0-Complete',
      acknowledged: true,
      clauses: {
        accessLicenseOnly: true,
        noFinancialAdvice: true,
        proprietaryMethodologyConfidential: true,
        nonRedistributionOfDerivativeWorks: true,
        tradeSecretProtectionDTSA: true,
        noReverseEngineering: true
      }
    },
    
    // Gap #2: Reasonable efforts to maintain secrecy (UTSA/DTSA requirement)
    reasonableEffortsSecrecy: {
      operatorMeasures: [
        'Multi-factor authentication and session-based access control',
        'Device fingerprinting with unique hardware binding',
        'Continuous session tracking and suspicious activity monitoring',
        'TLS encryption for all data transmission and storage',
        'Comprehensive audit trails logging all access and modifications',
        'IP geofencing and behavioral anomaly detection'
      ],
      userResponsibilities: [
        'User responsible for protecting login credentials - no sharing permitted',
        'User must enable all offered security features (2FA, device fingerprint)',
        'User must not store or backup proprietary data outside platform',
        'User must report suspicious access within 24 hours'
      ],
      complianceStatement: 'Both parties commit to reasonable protective measures meeting UTSA § 1839 and DTSA § 1839(3)(A) standards'
    },
    
    intellectualProperty: {
      acknowledged: true,
      protectedAssets: [
        'Pattern recognition algorithms and signal weighting formulas',
        'Real-time quote analysis methodology and timing models',
        'Data enrichment processes and proprietary calculations',
        'Alert delivery system architecture and scoring logic',
        'Historical performance analytics and backtesting results'
      ],
      licenseGrant: 'Limited, non-transferable, non-sublicensable access for personal use only',
      prohibitedUses: [
        'Reverse engineering or decompiling platform logic',
        'Creating derivative or competing services',
        'Redistributing alerts, scores, or analyses',
        'Commercial exploitation of methodology or data',
        'Automated scraping or systematic extraction'
      ]
    },
    
    tradeSecretProtection: {
      doctrines: 'UTSA and Defend Trade Secrets Act (DTSA) 18 U.S.C. § 1836',
      definition: 'Platform methodology qualifies as trade secret: not publicly known, derives economic value from secrecy, subject to reasonable protective measures.',
      exemplaryRemedies: {
        injunctiveRelief: 'Automatic TRO available without bond - prevent/stop misappropriation immediately',
        actualDamages: 'Full recovery of losses from breach plus unjust enrichment',
        exemplaryDamages: 'Up to 2x actual damages for willful/malicious misappropriation under DTSA',
        attorneyFees: 'Prevailing party recovers full legal costs'
      }
    },
    
    quasiContractTheory: {
      doctrine: 'Law imposes obligation preventing unjust enrichment even without express contract',
      remedy: 'User must disgorge all profits/value gained from unauthorized sharing'
    },
    
    tortiousInterference: {
      doctrine: 'Third-party recipients knowingly receiving breached data are jointly liable',
      liability: 'Both user AND third-party recipient liable for damages'
    },
    
    confidentiality: {
      scope: 'Proprietary methodology and derived data only',
      protected: [
        'Signal generation methodology and algorithm',
        'Pattern weights and parameters',
        'Timing models and market logic',
        'All derivative works'
      ],
      notProtected: [
        'Public SEC/SEDAR filings',
        'Publicly reported stock prices',
        'General market information'
      ],
      dataMarking: 'ALL outputs marked "CONFIDENTIAL - TRADE SECRET. Personal use only. Unauthorized sharing triggers $10,000+ DTSA damages"',
      breachRemedies: {
        injunction: 'Cease sharing, destroy derivatives',
        damages: '$10,000 per unauthorized disclosure (liquidated damages)',
        exemplary: '2x under DTSA for willful breach',
        fees: 'All attorney fees and costs'
      }
    },
    
    // Gap #7: Justify liquidated damages reasonableness
    liquidatedDamagesJustification: {
      developmentCost: 'Methodology development exceeds $50,000 in professional research and testing',
      competitiveAdvanceLoss: 'Single disclosure to competitor eliminates $100,000+ in expected advantage',
      investigationCost: 'Breach investigation, forensics, legal review averages $10,000-$25,000 per incident',
      marketComparison: 'Actual trade secret misappropriation damages documented at $50,000-$500,000+ in case law',
      preEstimate: '$10,000 represents reasonable pre-estimate of harm, NOT a penalty - user explicitly acknowledges reasonableness'
    },
    
    blackLawEnhancements: {
      contraProferentem: 'User waives ambiguity interpretation - sophisticated contract, equal bargaining power',
      inPariDelicto: 'Breacher cannot assert fair use/first amendment defenses while violating confidentiality',
      uncleanHands: 'Equity denies relief to those with unclean hands - breacher barred from equitable defenses',
      volentiNonFitInjuria: 'Willing participant in acceptance = consent to all terms',
      lachesEstoppel: 'Claiming "didn\'t understand" after acceptance = estoppel - conduct locks them in'
    },
    
    // Gap #6: Sophisticated party acknowledgment
    sophisticatedPartyAcknowledgment: {
      userConfirms: [
        'I am of legal age and competent to enter binding agreements',
        'I have had opportunity to review this entire agreement carefully',
        'I have adequate understanding of all legal implications and remedies',
        'This agreement is voluntary - no duress, fraud, or undue influence',
        'I acknowledge equal bargaining power with operator',
        'I am not relying on any external representations beyond what\'s written here'
      ]
    },
    
    // Gap #8: Anti-waiver paradox clause
    antiWaiverClause: 'This confidentiality and quasi-contract obligation survives independent of any other waiver. User cannot waive this clause itself - it protects both parties and the public interest. Any purported oral or written waiver of this clause is void and unenforceable. Acceptance of this agreement creates perpetual confidentiality duty that survives termination.',
    
    // Gap #9: No authority to modify clause
    noAuthorityModifyClause: 'No employee, agent, representative, or AI system has authority to modify this agreement except in writing signed by both parties. Any purported oral modification, email modification, or statement "admin said this was okay" is completely void. Only written instrument signed by both operator and user can modify these terms.',
    
    // Gap #10: Breach detection and cease & desist procedure
    breachDetectionProcedure: {
      discovery: 'Operator detects breach through: public sharing, third-party disclosure, social media/Reddit posts, automated monitoring, or user confession',
      operatorSteps: [
        'Step 1: Send formal cease & desist notice documenting discovery evidence',
        'Step 2: Demand user disgorge all profits/value gained from breach within 14 days',
        'Step 3: If ignored, file for emergency TRO with supporting evidence',
        'Step 4: Pursue actual damages, 2x exemplary under DTSA, plus attorney fees',
        'Step 5: Report willful breach to law enforcement if criminal trade secret theft'
      ],
      userResponsibilities: 'User MUST immediately cease sharing, destroy all derivatives, and restore confidentiality upon notice or legal action begins automatically without further notice'
    },
    
    proceduralEnforcement: {
      automaticInjunction: 'Breach = right to TRO without posting bond',
      liquidatedDamages: '$10,000 per disclosure (reasonable pre-estimate per Gap #7 justification)',
      securityBond: 'May require $25,000 bond to contest claims',
      discoveryAdmissions: 'FRCP 36 - unanswered admissions deemed admitted',
      spoliation: 'Destruction of communications = adverse inference (jury presumes guilt)',
      prejudgmentInterest: 'Daily compounding interest from breach date'
    },
    
    contractSignature: {
      mandatory: 'Explicit checkbox acceptance REQUIRED before platform access - blocksAccess = true until all items checked',
      clickwrapGate: 'User must scroll to bottom of agreement and check ALL 15 acknowledgment boxes before ANY platform access granted',
      acknowledgments: [
        '[Gap #6] I am of legal age, competent, had opportunity to review, understand implications, voluntary, equal bargaining power, not relying on external reps',
        '[DTSA] Trade secrets protected under DTSA - I understand 2x exemplary damages available for willful breach',
        '[Quasi-Contract] Sharing triggers quasi-contract and unjust enrichment liability - I must disgorge all profits',
        '[Third-Party] Third-party recipients jointly liable with me - anyone I share with is equally sued',
        '[Black\'s Law] All Black\'s Law Dictionary definitions incorporated - bound by sophisticated legal meanings',
        '[Waiver] I waive all defenses including fair use, first amendment, ambiguity, unconscionability',
        '[Gap #7] Acknowledge $10,000 per disclosure liquidated damages is REASONABLE pre-estimate, not penalty',
        '[TRO] Breaching this = automatic right to TRO and attorney fees shifted entirely to me',
        '[Device] My device is uniquely bound to this agreement - cannot disclaim, "wasn\'t me", or claim device theft defense',
        '[Exemplary] I accept operator may pursue 2x exemplary damages under DTSA for willful or reckless breach',
        '[Fees] I understand operator will recover ALL legal costs and attorney fees from me if I breach',
        '[Gap #8] I understand this confidentiality obligation is UNWAIVABLE - no party can cancel it',
        '[Gap #9] I understand no employee/agent has authority to modify - only written document signed by both parties',
        '[Gap #2] I commit to reasonable security efforts: protect credentials, enable 2FA, report suspicious access within 24 hours',
        '[Gap #3] I acknowledge ALL data outputs marked CONFIDENTIAL - TRADE SECRET and understand $10k+ damages for sharing'
      ]
    }
  };
};

// Generate IPFS-compatible SHA-256 hash of contract + device fingerprint for immutable proof
const generateContractHash = (fingerprint, contractData) => {
  try {
    // Combine contract terms with device fingerprint for unique hash
    const contractString = JSON.stringify(contractData);
    const combinedData = `${contractString}::${fingerprint}`;
    const hash = crypto.createHash('sha256').update(combinedData).digest('hex');
    // Return as IPFS-style hash reference
    return `sha256:${hash}`;
  } catch (err) {
    log('WARN', `Failed to generate contract hash: ${err.message}`);
    return null;
  }
};

// Gap #1: Mandatory clickwrap validation - blocks access until ALL acknowledgments checked + scrolled to bottom
const validateClickwrapAcceptance = (sessionData) => {
  // Validate clickwrap acceptance object
  if (!sessionData.clickwrapAcceptance) {
    return { valid: false, reason: 'No clickwrap acceptance data provided' };
  }
  
  const acceptance = sessionData.clickwrapAcceptance;
  
  // Verify all 15 acknowledgment boxes are checked
  const requiredAcknowledgments = 15;
  if (!acceptance.acknowledgementsChecked || acceptance.acknowledgementsChecked.length !== requiredAcknowledgments) {
    return { valid: false, reason: `Must check all ${requiredAcknowledgments} legal acknowledgments` };
  }
  
  // Verify user scrolled to bottom of agreement
  if (!acceptance.scrolledToBottom) {
    return { valid: false, reason: 'Must scroll to bottom of agreement before accepting' };
  }
  
  // Verify timestamp is recent (within 2 hours)
  const acceptanceTime = new Date(acceptance.timestamp);
  const now = new Date();
  if (now - acceptanceTime > 2 * 60 * 60 * 1000) {
    return { valid: false, reason: 'Acceptance expired - please review agreement again' };
  }
  
  // Verify device fingerprint matches
  if (acceptance.deviceFingerprint !== sessionData.fingerprint) {
    return { valid: false, reason: 'Device fingerprint mismatch - possible security issue' };
  }
  
  return { valid: true, reason: 'Clickwrap acceptance valid' };
};

// Save contract signature when user approves login - creates immutable proof of consent
// Now includes all 10 gap closures for 100% enforceability
const saveContractSignature = (sessionId, meta, userAgent) => {
  try {
    let securityLog = [];
    if (fs.existsSync(SECURITY_LOG_FILE)) {
      const raw = fs.readFileSync(SECURITY_LOG_FILE, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        securityLog = Array.isArray(parsed) ? parsed : [];
      }
    }

    const approvalTimestamp = new Date().toISOString();
    const deviceInfo = extractDeviceInfo(userAgent);
    
    // Add or update contract signature for this session
    const existingEntry = securityLog.find(entry => entry.sessionId === sessionId);
    if (existingEntry) {
      // Add contract signature to existing session entry
      if (!existingEntry.contractAgreements) {
        existingEntry.contractAgreements = {};
      }
      
      // All 10 gaps now included in saved contract + 5 critical professional upgrades
      existingEntry.contractAgreements.contractSignature = {
        approvalStatus: 'APPROVED',
        approvalTimestamp,
        approvalSessionId: sessionId,
        version: '3.0-Elite',
        legalFramework: 'Delaware UTSA (Title 6, Ch 20) + Federal DTSA (18 U.S.C. § 1836) + Black\'s Law Dictionary v11 + JAMS Arbitration',
        
        // Gap #1: Clickwrap gate enforced - saved only after validation
        clickwrapEnforced: true,
        clickwrapData: {
          allAcknowledgementsChecked: true,
          scrolledToBottomConfirmed: true,
          validationTimestamp: approvalTimestamp
        },
        
        // CRITICAL UPGRADE #1: Delaware UTSA statutory incorporation
        delawareUTSACompliance: {
          statute: 'Delaware Code Title 6, Chapter 20',
          venue: 'Court of Chancery of the State of Delaware',
          governingLaw: 'Delaware law without regard to conflict principles',
          tradeSecretDefinition: 'Information deriving independent economic value from not being generally known, subject to reasonable efforts to maintain secrecy',
          reasonableEffortsStandard: 'Multi-factor auth, device fingerprinting, audit trails, TLS encryption, access controls meeting industry standards',
          damagesToAvailable: 'Treble damages available for willful/malicious misappropriation',
          attorneyFeesRecovery: 'Prevailing party recovers all attorney fees and costs'
        },
        
        // CRITICAL UPGRADE #2: DTSA whistleblower immunity notice (REQUIRED for enforcement)
        dtsaWhistleblowerNotice: {
          statute: '18 U.S.C. § 1833(b)(3)(B)',
          legalRequirement: 'This notice is REQUIRED by federal statute and does not waive confidentiality',
          immunity: 'User protected from criminal/civil liability for disclosing trade secrets in confidence to government official or attorney for reporting suspected legal violations',
          conditions: 'Disclosure must be (A) in confidence, (B) to government official/attorney, (C) solely for reporting suspected violation',
          implication: 'Whistleblower protections survive this agreement but do not authorize profit-seeking disclosure',
          notice: '*** 18 U.S.C. § 1833(b) NOTICE: Whistleblower protections apply to reports of suspected legal violations. This notice is required by federal law. ***'
        },
        
        // CRITICAL UPGRADE #3: Personal jurisdiction consent
        personalJurisdictionConsent: {
          consentToJurisdiction: 'User IRREVOCABLY CONSENTS to personal jurisdiction in Delaware for any dispute arising from this agreement',
          agentForService: 'User APPOINTS Delaware Secretary of State as agent for service of process - service on Secretary is valid and binding',
          waiver: 'User IRREVOCABLY WAIVES: (A) objections to venue; (B) objections to personal jurisdiction; (C) "inconvenient forum" defenses; (D) all bases to challenge Delaware jurisdiction',
          effectivity: 'This consent is perpetual and irrevocable, surviving termination of all other terms',
          internationalNotice: 'If user is outside US, this clause means you consent to Delaware courts even if you never visit US'
        },
        
        // CRITICAL UPGRADE #4: JAMS mandatory arbitration (faster, cheaper, more private than court)
        mandatoryArbitration: {
          mechanism: 'ALL disputes resolved through BINDING ARBITRATION (not court)',
          forum: 'JAMS (Judicial Arbitration and Mediation Services) Comprehensive Arbitration Rules',
          location: 'Wilmington, Delaware',
          panel: 'Three-arbitrator panel (or single arbitrator if claim < $250k)',
          arbitrators: 'Selected from JAMS retired judges and trade secret law specialists',
          evidenceRules: 'Delaware evidence rules and DTSA case law apply',
          discovery: 'Full discovery available with expedited procedures for trade secret cases',
          confidentiality: 'All proceedings STRICTLY CONFIDENTIAL - no public record',
          costs: 'Losing party pays: (A) all arbitration costs; (B) arbitrators\' fees; (C) JAMS administrative costs; (D) all discovery costs',
          attorneyFees: 'LOSING PARTY PAYS: All reasonable attorney fees, paralegal fees, expert witness fees of WINNING PARTY',
          appeal: 'NO APPEAL except for manifest disregard of law or fraud in arbitration',
          barToLitigation: 'User WAIVES right to court litigation - binding arbitration is exclusive remedy'
        },
        
        // CRITICAL UPGRADE #5: PepsiCo inevitable disclosure doctrine (prevents competitive employment)
        inevitableDisclosureInjunction: {
          doctrine: 'PepsiCo, Inc. v. Redmond, 54 F.3d 1262 (7th Cir. 1995)',
          principle: 'If user accepts employment with direct competitor, trade secrets will inevitably be disclosed despite best efforts',
          injunction: 'User CONSENTS to 12-month post-termination INJUNCTION prohibiting employment with direct competitors',
          competitors: 'Direct competitor defined as: (A) firms providing trade signal algorithms; (B) funds using pattern recognition for trading; (C) services offering proprietary quote analysis',
          scope: 'Injunction applies GLOBALLY for 12 months after user\'s employment/access termination',
          exceptions: 'User may work for competitor ONLY if: (A) Operator provides written consent; (B) User accepts monitoring; (C) User demonstrates compartmentalization of knowledge',
          considerationAck: 'User acknowledges this injunction is reasonable given proprietary information provided and competitive advantage at stake'
        },
        
        // Original acknowledgments + new ones for critical upgrades
        explicitAcknowledgments: [
          '[Gap #6] I am of legal age, competent, had opportunity to review, understand implications, voluntary, equal bargaining power',
          '[DTSA] Trade secrets protected under DTSA - I understand 2x exemplary damages available for willful breach',
          '[Quasi-Contract] Sharing triggers quasi-contract and unjust enrichment liability - I must disgorge all profits',
          '[Third-Party] Third-party recipients jointly liable with me - anyone I share with is equally sued',
          '[Black\'s Law] All Black\'s Law Dictionary definitions incorporated - bound by sophisticated legal meanings',
          '[Waiver] I waive all defenses including fair use, first amendment, ambiguity, unconscionability',
          '[Gap #7] Acknowledge $10,000 per disclosure liquidated damages is REASONABLE pre-estimate, not penalty',
          '[TRO] Breaching this = automatic right to TRO and attorney fees shifted entirely to me',
          '[Device] My device is uniquely bound to this agreement - cannot disclaim, "wasn\'t me", or claim device theft defense',
          '[Exemplary] I accept operator may pursue 2x exemplary damages under DTSA for willful or reckless breach',
          '[Fees] I understand operator will recover ALL legal costs and attorney fees from me if I breach',
          '[Gap #8] I understand this confidentiality obligation is UNWAIVABLE - no party can cancel it',
          '[Gap #9] I understand no employee/agent has authority to modify - only written document signed by both parties',
          '[Gap #2] I commit to reasonable security efforts: protect credentials, enable 2FA, report suspicious access within 24 hours',
          '[Gap #3] I acknowledge ALL data outputs marked CONFIDENTIAL - TRADE SECRET and understand $10k+ damages for sharing',
          '[Critical #1] I CONSENT to Delaware Code Title 6, Ch 20 UTSA and Delaware Chancery Court jurisdiction',
          '[Critical #2] I ACKNOWLEDGE DTSA § 1833(b) whistleblower notice and understand whistleblower protections do not authorize profit-seeking disclosure',
          '[Critical #3] I IRREVOCABLY CONSENT to Delaware personal jurisdiction and appoint Secretary of State as my agent for service',
          '[Critical #4] I ACCEPT JAMS mandatory arbitration as exclusive remedy - I waive right to court litigation',
          '[Critical #5] I CONSENT to 12-month post-employment injunction preventing competitive employment under PepsiCo doctrine'
        ],
        
        // Gap #2: Reasonable efforts documentation
        reasonableEffortsCompliance: {
          operatorMeasures: ['Multi-factor auth', 'Device fingerprinting', 'Session tracking', 'TLS encryption', 'Audit trails', 'IP geofencing'],
          userResponsibilities: ['Protect credentials', 'Enable 2FA', 'No backup outside platform', 'Report suspicious access in 24h'],
          standard: 'UTSA § 1839 and DTSA § 1839(3)(A)'
        },
        
        // Gap #3: Data marking confirmation
        dataMarking: 'ALL outputs marked CONFIDENTIAL - TRADE SECRET. Unauthorized sharing = $10,000+ DTSA damages',
        
        // Gap #4: Consideration documented
        consideration: {
          operatorProvides: 'Exclusive proprietary real-time quote analysis, signal scores, timing models, enriched datasets not available elsewhere',
          userCommits: 'Maintains strict confidentiality, no reverse engineering, no redistribution, no derivatives'
        },
        
        // Gap #5: Jurisdiction specified
        jurisdiction: {
          governing: 'Delaware Code Title 6, Chapter 20',
          federal: 'Federal DTSA (18 U.S.C. § 1836)',
          userConsumer: 'User retains consumer protection rights in home state'
        },
        
        // Gap #7: Liquidated damages justification
        liquidatedDamagesJustification: {
          developmentCost: 'Methodology development exceeds $50,000',
          competitiveAdvanceLoss: 'Single disclosure = $100,000+ competitive advantage loss',
          investigationCost: '$10,000-$25,000 per breach investigation',
          marketComparison: 'Actual trade secret damages documented at $50,000-$500,000+',
          amount: '$10,000',
          status: 'REASONABLE pre-estimate, NOT penalty'
        },
        
        // Gap #8: Anti-waiver clause
        antiWaiverClause: 'This confidentiality and quasi-contract obligation SURVIVES all other waivers and cannot be waived itself. Any purported waiver is void and unenforceable.',
        
        // Gap #9: No authority to modify
        noModificationClause: 'No employee/agent/representative/AI system has authority to modify. Only written instrument signed by both parties modifies this agreement.',
        
        // Gap #10: Breach procedure
        breachProcedure: {
          discovery: 'Operator detects through: public sharing, third-party disclosure, social media posts, automated monitoring',
          operatorSteps: [
            'Step 1: Formal cease & desist with evidence',
            'Step 2: Demand disgorgement within 14 days',
            'Step 3: File emergency TRO if ignored',
            'Step 4: Pursue actual damages + 2x exemplary + attorney fees',
            'Step 5: Report to law enforcement if criminal'
          ]
        },
        
        signatureEvidence: {
          deviceFingerprint: meta.fingerprint,
          ipAddress: meta.ip,
          browserUserAgent: userAgent,
          timestamp: approvalTimestamp,
          contractHash: generateContractHash(meta.fingerprint, existingEntry.contractAgreements),
          bindingMechanism: 'Device DNA (fingerprint) + timestamp + signature immutably locks user to this agreement - device cannot be disclaimed'
        }
      };
    }

    fs.writeFileSync(SECURITY_LOG_FILE, JSON.stringify(securityLog, null, 2));
    log('AUTH', `Saved comprehensive contract v1.0 with all 10 gaps closed for session ${sessionId}`);
  } catch (err) {
    log('WARN', `Failed to save contract signature: ${err.message}`);
  }
};

const renderWaitingPage = (res, sessionId) => {
  res.status(202).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Login authentication</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      background: #1a1a1a;
      color: #e0e0e0;
    }
    .card {
      width: 100%;
      max-width: 520px;
      background: #232323;
      border-radius: 14px;
      border: 1px solid #3a3a3a;
      box-shadow: 0 18px 40px rgba(0,0,0,0.65);
      padding: 34px 24px 10px;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #2ac522ff;
      box-shadow: 0 0 10px rgba(48, 197, 34, 0.6);
    }
    h1 {
      margin: 0;
      font-size: 1.01rem;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    p { margin: 6px 0; font-size: 0.96rem; }
    .session {
      margin-top: 10px;
      font-size: 1.01rem;
      color: #9ca3af;
    }
    .session code {
      background: #2b2b2b;
      padding: 4px 8px;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.98rem;
      color: #f3f4f6;
    }
    .meta {
      margin-top: 10px;
      font-size: 0.86rem;
      color: #ffffff74;
    }
    .utc-time {
      margin-top: 6px;
      font-size: 0.726rem;
      color: #ffffff3b;
      text-align: right;
    }
    .terms-box {
      background: rgba(31, 31, 31, 0.7);
      border-left: 7px solid #666;
      padding: 13px 7px;
      margin: 9px 0;
      border-radius: 5px;
      font-size: 0.86rem;
      line-height: 1.1;
      color: #d1d5db;
      border: 1px solid rgba(100, 100, 100, 0.3);
    }
    .terms-box strong {
      color: #ffffffd4;
      font-size: 0.975rem;
      display: block;
      margin-bottom: 4px;
    }
    .checkbox-container {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 14px 0;
    }
    .checkbox-container input[type="checkbox"] {
      margin-top: 4px;
      cursor: pointer;
      accent-color: #6c6c6ca1;
    }
    .checkbox-container label {
      cursor: pointer;
      flex: 1;
      font-size: 0.9rem;
    }
    button {
      width: 33%;
      padding: 6px 10px;
      margin-top: 8px;
      margin-left: auto;
      margin-right: auto;
      display: block;
      background: rgba(35, 35, 35, 0.6);
      color: #e0e0e0;
      border: 1px solid #77777799;
      border-radius: 4px;
      font-weight: 500;
      cursor: pointer;
      font-size: 0.88rem;
      transition: all 0.2s;
    }
    button:hover {
      background: rgba(43, 43, 43, 0.8);
      border-color: #65656585;
      transform: translateY(-1px);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <div class="dot"></div>
      <h1 style="font-size: 1.2rem;">Login request awaiting confirmation...</h1>
    </div>
    <p class="session">Login ID: <code>${sessionId}</code></p>
    <p style="font-size: 0.8rem; color: #888; margin: 8px 0; font-style: italic;">This information is confidential and not financial advice. Do not redistribute or share with others.</p>
        
    <p style="font-size: 0.7rem; color: #666; margin: 20px 0 8px 0; font-style: italic;">If this session is taking longer than expected, contact the admin directly.</p>
    <p class="utc-time" id="utc-time">--:--:-- UTC</p>
  </div>
  <script>
    (function() {
      // Handle confirm button click (only if button exists)
      const confirmBtn = document.getElementById('confirm-btn');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Confirming...';
          try {
            const res = await fetch('/api/accept-terms', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: '${sessionId}' })
            });
            if (res && res.ok) {
              confirmBtn.textContent = 'Confirmed';
              // Give server a moment to write logs then reload to pick up approved state
              setTimeout(() => window.location.reload(), 250);
            } else {
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Confirm';
              alert('Failed to confirm — please try again');
            }
          } catch (e) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirm';
            alert('Network error — could not reach server');
          }
        });
      }
      
      async function checkStatus() {
        try {
          const res = await fetch('/api/auth-status', { cache: 'no-store' });
          const data = await res.json();
          if (data.status === 'approved') {
            window.location.reload();
          } else if (data.status === 'denied') {
            const header = document.querySelector('.card h1');
            if (header) header.textContent = 'Login request denied by owner';
          }
        } catch (e) {
          // Silent fail; page will keep polling
        }
      }

      function updateUtcClock() {
        const el = document.getElementById('utc-time');
        if (!el) return;
        const now = new Date();
        const time = now.toISOString().split('T')[1].split('.')[0];
        el.textContent = time + ' UTC';
      }

      checkStatus();
      setInterval(checkStatus, 2000);
      updateUtcClock();
      setInterval(updateUtcClock, 1000);
    })();
  </script>
</body>
</html>`);
};

// Second-factor gate: require manual owner approval per session
const loginApprovalGate = (req, res, next) => {
  // If 2FA is disabled, skip the approval gate entirely
  if (!CONFIG.TWO_FACTOR_ENABLED) {
    return next();
  }

  // Skip auth for static files and certain endpoints - DON'T log/analyze these
  if (req.path === '/api/auth-status' || req.path === '/api/auth-send-code' || 
      req.path === '/api/auth-verify' || req.path === '/api/auth-register' || 
      req.path === '/api/auth-verify-register' || req.path === '/api/ping' || 
      req.path === '/api/send-access-request' ||
      req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/i)) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie || '');
  let sessionId = cookies.sid;

  // Already fully approved session
  if (sessionId && approvedSessions.has(sessionId)) {
    return next();
  }

  // Explicitly denied
  if (sessionId && deniedSessions.has(sessionId)) {
    return res.status(403).send('Access denied by owner.');
  }

  // New or unknown session -> create a pending entry
  if (!sessionId || !pendingLogins.has(sessionId)) {
    sessionId = generateSessionId();
    const meta = getClientMetadata(req);
    const trafficData = analyzeTraffic(req, sessionId);
    const fingerprint = getClientFingerprint(req);
    const deviceInfo = extractDeviceInfo(meta.userAgent);
    const isVpn = detectVPNProxy(meta.ip);

    pendingLogins.set(sessionId, {
      ...meta,
      ...trafficData.security,
      fingerprint,
      deviceInfo,
      isVpn,
      threatLevel: trafficData.threat_level,
      suspicionScore: trafficData.security.suspicion_score,
      createdAt: new Date().toISOString(),
    });
    lastPendingSessionId = sessionId;
    // Log initial AUTH information when pending session created
    log('AUTH', `pending session=${sessionId}`);
    log('AUTH', `ip=${meta.ip} country=${meta.country} method=${meta.method} path=${meta.path}`);
    log('AUTH', `host=${meta.headers.host || 'Unknown'} referer=${meta.headers.referer || 'None'}`);
    log('AUTH', `ua=${meta.userAgent}`);
    log('AUTH', `xff=${meta.headers['x-forwarded-for'] || 'None'}`);
    log('AUTH', 'cmds: [yes] [no] [approve <id>] [deny <id>] [list]');
    if (hasInteractivePrompt) rl.prompt();

    res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/; SameSite=Lax`);
    return renderWaitingPage(res, sessionId);
  }

  // Existing pending session - still waiting on owner
  return renderWaitingPage(res, sessionId);
};

app.get('/api/performance-summary', (req, res) => {
  try {
    let stocks = [];
    let performanceData = {};
    
    // Load stocks.json for unique trades (better than alerts which has duplicates)
    if (fs.existsSync(CONFIG.STOCKS_FILE)) {
      const content = fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8').trim();
      if (content) {
        try {
          stocks = JSON.parse(content);
          if (!Array.isArray(stocks)) stocks = [];
        } catch (e) {
          stocks = [];
        }
      }
    }
    
    // Load performance data for cross-reference
    if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
      const content = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
      if (content) {
        try {
          performanceData = JSON.parse(content);
        } catch (e) {
          performanceData = {};
        }
      }
    }
    
    if (!stocks || stocks.length === 0) {
      return res.json({ winRate: 0, totalTrades: 0, topPerformers: [], bestPerformer: null });
    }
    
    // Get all trades with their CURRENT performance data from stocks.json
    const allTrades = stocks.map(stock => {
      const ticker = stock.ticker;
      const alertPrice = stock.price || 0;
      // Check both isShort field and direction field for compatibility
      const isShort = stock.isShort === true || stock.direction === 'SHORT';
      
      // Use the peak data already calculated in stocks.json
      let peakPercent = 0;
      let isWinner = false;
      
      if (isShort) {
        // For shorts: positive lowest5DayPercent means price went down = profit
        peakPercent = stock.lowest5DayPercent || 0;
        isWinner = peakPercent > 0; // Positive = profit for short
      } else {
        // For longs: positive highest5DayPercent means price went up = profit
        peakPercent = stock.highest5DayPercent || 0;
        isWinner = peakPercent > 0; // Positive = profit for long
      }
      
      return {
        ticker,
        peakPercent: Math.abs(peakPercent), // Use absolute for display
        isShort: isShort,
        alert: alertPrice,
        isWinner: isWinner
      };
    });
    
    // Filter out 0% trades (no movement yet) - EXCLUDE from all calculations
    const validTrades = allTrades.filter(t => t.peakPercent !== 0 && !isNaN(t.peakPercent));
    const winningTrades = validTrades.filter(t => t.isWinner);
    const winRate = validTrades.length > 0 ? Math.round((winningTrades.length / validTrades.length) * 100) : 0;
    
    // Get top 5 performers by peak % - from ALL valid trades (not just winners)
    const topPerformers = validTrades
      .sort((a, b) => b.peakPercent - a.peakPercent)
      .slice(0, 5)
      .map(t => ({
        ticker: t.ticker,
        peak5Day: t.peakPercent,
        direction: t.isShort ? 'SHORT' : 'LONG'
      }));
    
    // Find best performer
    const bestPerformer = topPerformers.length > 0 ? topPerformers[0] : null;
    
    res.json({
      winRate: winRate,
      totalTrades: stocks.length,
      winningTrades: winningTrades.length,
      topPerformers: topPerformers,
      bestPerformer: bestPerformer
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Serve stocks.json publicly (BEFORE auth middleware)
app.get('/logs/stocks.json', (req, res) => {
  try {
    if (fs.existsSync(CONFIG.STOCKS_FILE)) {
      const data = fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUBLIC Quote endpoint - NO AUTH REQUIRED
app.get('/api/quote/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  
  try {
    // Try Yahoo Finance first
    let quote = await yahooFinance.quote(ticker, {
      fields: ['regularMarketPrice', 'regularMarketVolume', 'marketCap', 'exchange'],
    }).catch(() => null);
    
    // If Yahoo fails, try FMP
    if (!quote || !quote.regularMarketPrice) {
      const finnhubKey = process.env.FINNHUB_API_KEY;
      if (finnhubKey) {
        try {
          const finnhubRes = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`, 5000);
          if (finnhubRes.ok) {
            const data = await finnhubRes.json();
            if (data.c && data.c > 0) {
              quote = {
                symbol: ticker,
                regularMarketPrice: data.c,
                regularMarketVolume: data.v || 0,
                marketCap: 'N/A',
                sharesOutstanding: 'N/A',
                averageDailyVolume3Month: 0,
                exchange: 'UNKNOWN'
              };
              
              try {
                const profRes = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${finnhubKey}`, 5000);
                if (profRes.ok) {
                  const prof = await profRes.json();
                  if (prof.shareOutstanding && prof.shareOutstanding > 0) {
                    quote.sharesOutstanding = Math.round(prof.shareOutstanding);
                  }
                  if (prof.marketCapitalization && prof.marketCapitalization > 0) {
                    quote.marketCap = Math.round(prof.marketCapitalization * 1000000);
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
    
    if (!quote || !quote.regularMarketPrice) {
      quote = await getFMPQuote(ticker);
    }
    
    let fundamentals = {};
    try {
      if (fs.existsSync(CONFIG.ALERTS_FILE)) {
        const alerts = JSON.parse(fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8'));
        const latestAlert = alerts.filter(a => a.ticker === ticker).pop();
        if (latestAlert) {
          fundamentals = {
            float: latestAlert.float || 'N/A',
            sharesOutstanding: latestAlert.sharesOutstanding || 'N/A',
            soRatio: latestAlert.soRatio || 'N/A',
            averageVolume: latestAlert.averageVolume || 0
          };
        }
      }
    } catch (e) {}
    
    if (!fundamentals.float || fundamentals.float === 'N/A') {
      fundamentals.float = quote?.floatShares || await getFloatData(ticker);
    }
    
    if (!fundamentals.sharesOutstanding || fundamentals.sharesOutstanding === 'N/A') {
      fundamentals.sharesOutstanding = quote?.sharesOutstanding || await getSharesOutstanding(ticker);
    }
    
    res.json({
      symbol: ticker,
      price: quote?.regularMarketPrice || 'N/A',
      volume: quote?.regularMarketVolume || 0,
      averageVolume: fundamentals.averageVolume || quote?.averageDailyVolume3Month || 0,
      marketCap: quote?.marketCap || 'N/A',
      exchange: quote?.exchange || 'UNKNOWN',
      float: fundamentals.float || 'N/A',
      sharesOutstanding: fundamentals.sharesOutstanding || 'N/A',
      soRatio: fundamentals.soRatio || 'N/A',
    });
    
    if (quote?.regularMarketPrice && quote.regularMarketPrice > 0) {
      try {
        let performanceData = {};
        if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
          const content = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
          if (content) {
            try {
              performanceData = JSON.parse(content);
              if (!performanceData || typeof performanceData !== 'object') {
                performanceData = {};
              }
            } catch (e) {
              performanceData = {};
            }
          }
        }
        
        if (performanceData[ticker]) {
          const currentPrice = quote.regularMarketPrice;
          performanceData[ticker].currentPrice = currentPrice;
          if (currentPrice > performanceData[ticker].highest) {
            performanceData[ticker].highest = currentPrice;
          }
          if (currentPrice < performanceData[ticker].lowest) {
            performanceData[ticker].lowest = currentPrice;
          }
          
          const alertPrice = performanceData[ticker].alert;
          if (alertPrice > 0) {
            const change = currentPrice - alertPrice;
            const percentChange = (change / alertPrice) * 100;
            performanceData[ticker].performance = parseFloat(percentChange.toFixed(2));
          }
          
          try {
            const tempFile = CONFIG.PERFORMANCE_FILE + '.tmp';
            fs.writeFileSync(tempFile, JSON.stringify(performanceData, null, 2));
            fs.renameSync(tempFile, CONFIG.PERFORMANCE_FILE);
          } catch (err) {
            fs.writeFileSync(CONFIG.PERFORMANCE_FILE, JSON.stringify(performanceData, null, 2));
          }
        }
      } catch (e) {}
    }
  } catch (error) {
    log('ERROR', `Quote endpoint error for ${ticker}: ${error.message}`);
    res.json({
      symbol: ticker,
      price: 'N/A',
      volume: 0,
      averageVolume: 0,
      marketCap: 'N/A',
      exchange: 'UNKNOWN',
      float: 'N/A',
      sharesOutstanding: 'N/A',
      soRatio: 'N/A'
    });
  }
});

// Apply both factors (basic auth + manual approval) to all routes
app.use(auth, loginApprovalGate);

// Endpoint used by the pending login page to detect when a session
// has been approved/denied and auto-redirect the browser.
app.get('/api/auth-status', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid;

  if (!sessionId) {
    return res.json({ status: 'none' });
  }
  if (approvedSessions.has(sessionId)) {
    return res.json({ status: 'approved' });
  }
  if (deniedSessions.has(sessionId)) {
    return res.json({ status: 'denied' });
  }
  if (pendingLogins.has(sessionId)) {
    return res.json({ status: 'pending' });
  }
  return res.json({ status: 'unknown' });
});

// Capture terms acceptance (creates binding record)
// Compress device DNA for forensic proof
function generateDeviceDNA(req, meta) {
  const deviceDNA = {
    // Raw headers for absolute proof
    headers: {
      user_agent: req.get('user-agent') || 'unknown',
      accept_language: req.get('accept-language') || 'unknown',
      accept_encoding: req.get('accept-encoding') || 'unknown',
      accept: req.get('accept') || 'unknown',
      host: req.get('host') || 'unknown',
      referer: req.get('referer') || 'none',
      connection: req.get('connection') || 'unknown',
      upgrade_insecure: req.get('upgrade-insecure-requests') || 'none',
      cache_control: req.get('cache-control') || 'none',
      sec_fetch_site: req.get('sec-fetch-site') || 'none',
      sec_fetch_mode: req.get('sec-fetch-mode') || 'none',
      sec_fetch_dest: req.get('sec-fetch-dest') || 'none',
      sec_ch_ua: req.get('sec-ch-ua') || 'none',
      sec_ch_ua_mobile: req.get('sec-ch-ua-mobile') || 'none',
    },
    
    // Network info
    network: {
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      x_forwarded_for: req.get('x-forwarded-for') || 'none',
      x_real_ip: req.get('x-real-ip') || 'none',
      port: req.socket?.remotePort || 'unknown'
    },
    
    // Device fingerprint components (uncompressed for proof)
    fingerprint_components: {
      user_agent_hash: crypto.createHash('sha256').update(req.get('user-agent') || '').digest('hex').substring(0, 16),
      language_hash: crypto.createHash('sha256').update(req.get('accept-language') || '').digest('hex').substring(0, 16),
      encoding_hash: crypto.createHash('sha256').update(req.get('accept-encoding') || '').digest('hex').substring(0, 16),
      ip_hash: crypto.createHash('sha256').update(req.ip || '').digest('hex').substring(0, 16),
    },
    
    // Parsed device info
    device_info: meta.deviceInfo || extractDeviceInfo(req.get('user-agent')),
    
    // Threat assessment
    threat_indicators: {
      is_bot: meta.deviceInfo?.isBot || false,
      is_mobile: meta.deviceInfo?.isMobile || false,
      is_vpn_proxy: detectVPNProxy(req.ip),
      threat_level: meta.threatLevel || 'unknown'
    },
    
    // Timestamp for absolute temporal proof
    timestamp: new Date().toISOString(),
    timestamp_ms: Date.now(),
    
    // Connection characteristics
    connection_info: {
      protocol: req.protocol || 'unknown',
      method: req.method || 'unknown',
      path: req.path || 'unknown',
      secure: req.secure || false
    }
  };
  
  // Create compressed DNA hash (single identifier for device)
  const dnaString = JSON.stringify({
    ua: deviceDNA.headers.user_agent,
    lang: deviceDNA.headers.accept_language,
    enc: deviceDNA.headers.accept_encoding,
    ip: deviceDNA.network.ip,
    browser: deviceDNA.device_info.browser,
    os: deviceDNA.device_info.os
  });
  
  deviceDNA.dna_hash = crypto.createHash('sha256').update(dnaString).digest('hex');
  deviceDNA.dna_compressed = Buffer.from(JSON.stringify(deviceDNA)).toString('base64').substring(0, 256);
  
  return deviceDNA;
}

app.post('/api/accept-terms', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid || req.body.sessionId;

  if (!sessionId || !pendingLogins.has(sessionId)) {
    return res.status(400).json({ error: 'Invalid session' });
  }

  const meta = pendingLogins.get(sessionId);
  const deviceDNA = generateDeviceDNA(req, meta);
  
  const acceptanceRecord = {
    sessionId,
    timestamp: new Date().toISOString(),
    timestamp_ms: Date.now(),
    
    // Contract terms
    accepted_terms: 'Personal research only, no resale/redistribution',
    contract_version: '1.0',
    
    // Device identification for proof of origin
    ip: meta.ip,
    fingerprint: meta.fingerprint,
    deviceInfo: meta.deviceInfo,
    threat_level: meta.threatLevel,
    
    // Comprehensive device DNA (proof of everything)
    device_dna: deviceDNA,
    
    // Metadata headers (proves browser type, location via language, etc)
    metadata: {
      user_agent: deviceDNA.headers.user_agent,
      accept_language: deviceDNA.headers.accept_language,
      accept_encoding: deviceDNA.headers.accept_encoding,
      x_forwarded_for: deviceDNA.network.x_forwarded_for,
      referer: deviceDNA.headers.referer,
      sec_ch_ua: deviceDNA.headers.sec_ch_ua,
    },
    
    // This becomes the contract baseline - any deviation = breach
    baseline_usage: {
      expected_access: 'stock_alerts_only',
      prohibited_access: 'personal_data, redistribution, bulk_export',
      expected_frequency: 'occasional_checks',
      expected_volume: 'low_to_moderate',
      baseline_ip: deviceDNA.network.ip,
      baseline_browser: deviceDNA.device_info.browser,
      baseline_os: deviceDNA.device_info.os,
      baseline_language: deviceDNA.headers.accept_language,
      baseline_dna_hash: deviceDNA.dna_hash
    },
    
    // Forensic evidence markers
    forensic_markers: {
      dna_hash: deviceDNA.dna_hash,
      dna_compressed: deviceDNA.dna_compressed,
      fingerprint_hash: meta.fingerprint,
      threat_indicators: deviceDNA.threat_indicators,
      connection_signature: crypto.createHash('sha256').update(
        `${deviceDNA.network.ip}-${deviceDNA.headers.user_agent}-${deviceDNA.headers.accept_language}`
      ).digest('hex')
    }
  };

  // Log the acceptance as a contract signature with full forensic detail
  appendAuthLog({
    ...acceptanceRecord,
    event_type: 'terms_acceptance',
    legal_weight: 'binding_contract_signature',
    forensic_complete: true
  });

  // Also save to separate contract log for easy retrieval
  try {
    let contracts = [];
    const contractsFile = 'logs/contracts.json';
    if (fs.existsSync(contractsFile)) {
      const raw = fs.readFileSync(contractsFile, 'utf8').trim();
      if (raw) contracts = JSON.parse(raw) || [];
    }
    contracts.push(acceptanceRecord);
    if (contracts.length > 500) contracts = contracts.slice(-500);
    fs.writeFileSync(contractsFile, JSON.stringify(contracts, null, 2));
  } catch (err) {
    log('WARN', `Failed to write contracts log: ${err.message}`);
  }

  log('INFO', `Contract accepted: ${sessionId}`);
  
  // Log AUTH information only after user accepts terms (after button click)
  log('AUTH', `pending session=${sessionId}`);
  log('AUTH', `ip=${meta.ip} country=${meta.country} method=${meta.method} path=${meta.path}`);
  log('AUTH', `host=${meta.headers.host || 'Unknown'} referer=${meta.headers.referer || 'None'}`);
  log('AUTH', `ua=${meta.userAgent}`);
  log('AUTH', `xff=${meta.headers['x-forwarded-for'] || 'None'}`);
  log('AUTH', 'cmds: [yes] [no] [approve <id>] [deny <id>] [list]');
  
  res.json({ success: true, message: 'Terms accepted', dna_hash: deviceDNA.dna_hash });
});

// ============================================
// BREACH DETECTION SYSTEM
// ============================================
// Monitors for violations of terms agreement
// Tracks: volume anomalies, IP changes, automation patterns, scope violations

function checkForBreaches(sessionId, endpoint, meta = {}) {
  try {
    let contracts = [];
    if (fs.existsSync('logs/contracts.json')) {
      const raw = fs.readFileSync('logs/contracts.json', 'utf8').trim();
      if (raw) contracts = JSON.parse(raw) || [];
    }

    const contract = contracts.find(c => c.sessionId === sessionId);
    if (!contract) return null; // User hasn't accepted terms

    let breaches = [];

    // Check 1: Unauthorized endpoint access
    const prohibitedEndpoints = ['export', 'bulk', 'scrape', 'dump', 'admin', 'users'];
    const isProhibited = prohibitedEndpoints.some(p => endpoint.includes(p));
    if (isProhibited) {
      breaches.push({
        type: 'unauthorized_access',
        severity: 'HIGH',
        detail: `Attempted access to prohibited endpoint: ${endpoint}`,
        timestamp: new Date().toISOString()
      });
    }

    // Check 2: IP change (suggests sharing/forwarding)
    if (meta.ip && meta.ip !== contract.ip) {
      breaches.push({
        type: 'ip_change',
        severity: 'MEDIUM',
        detail: `IP changed from ${contract.ip} to ${meta.ip}`,
        timestamp: new Date().toISOString()
      });
    }

    // Check 3: Volume anomalies (bulk data access)
    if (meta.requestCount > 500 && meta.timeWindow === '1h') {
      breaches.push({
        type: 'volume_anomaly',
        severity: 'HIGH',
        detail: `Bulk data access: ${meta.requestCount} requests in 1 hour (scraping pattern)`,
        timestamp: new Date().toISOString()
      });
    }

    // Check 4: Automation/Bot pattern
    if (meta.requestInterval < 100) { // < 100ms between requests = bot
      breaches.push({
        type: 'automation_pattern',
        severity: 'HIGH',
        detail: 'Automated access pattern detected (bot/scraper behavior)',
        timestamp: new Date().toISOString()
      });
    }

    // Check 5: Device fingerprint changed (suggests IP forwarding to others)
    if (meta.fingerprint && meta.fingerprint !== contract.fingerprint) {
      breaches.push({
        type: 'device_change',
        severity: 'MEDIUM',
        detail: 'Access from different device/browser (possible unauthorized sharing)',
        timestamp: new Date().toISOString()
      });
    }

    return breaches.length > 0 ? breaches : null;
  } catch (err) {
    log('WARN', `Breach check failed: ${err.message}`);
    return null;
  }
}

function logBreach(sessionId, breaches) {
  try {
    let breachLog = [];
    if (fs.existsSync('logs/breaches.json')) {
      const raw = fs.readFileSync('logs/breaches.json', 'utf8').trim();
      if (raw) breachLog = JSON.parse(raw) || [];
    }

    const entry = {
      sessionId,
      detected_at: new Date().toISOString(),
      violations: breaches,
      breach_count: breaches.length,
      severity_summary: breaches.reduce((max, b) => {
        const levels = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        return Math.max(max, levels[b.severity] || 0);
      }, 0)
    };

    breachLog.push(entry);
    if (breachLog.length > 1000) breachLog = breachLog.slice(-1000);
    fs.writeFileSync('logs/breaches.json', JSON.stringify(breachLog, null, 2));

    // Alert owner to violations (silent logging - data is stored)
    // Breaches are logged to logs/breaches.json for forensic review
  } catch (err) {
    log('WARN', `Failed to log breach: ${err.message}`);
  }
}

// Serve static files from logs directory
app.use('/logs', express.static('logs'));

// Serve webm file from root BEFORE auth middleware
app.use(express.static('.', {
  setHeaders: (res, path) => {
    if (path.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    }
  }
}));

// Serve static files from ui directory with webm MIME type
app.use('/docs', express.static('docs', {
  setHeaders: (res, path) => {
    if (path.endsWith('.webm')) {
      res.setHeader('Content-Type', 'video/webm');
    }
  }
}));


app.get('/logs/alert.json', (req, res) => {
  try {
    if (fs.existsSync(CONFIG.ALERTS_FILE)) {
      const data = fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/logs/quote.json', (req, res) => {
  try {
    if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
      const data = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } else {
      res.json({});
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/git-status', (req, res) => {
  try {
    const projectRoot = '/home/user/Documents/sysd';
    const status = execSync(`cd ${projectRoot} && git status --porcelain 2>/dev/null`, { encoding: 'utf8' }).trim();
    const lastCommit = execSync(`cd ${projectRoot} && git log -1 --pretty=format:"%h - %s (%ai)" 2>/dev/null`, { encoding: 'utf8' }).trim();
    const branch = execSync(`cd ${projectRoot} && git rev-parse --abbrev-ref HEAD 2>/dev/null`, { encoding: 'utf8' }).trim();
    
    log('INFO', `Git: Last commit: ${lastCommit || 'No commits'}`);
    
    res.json({
      status: 'online',
      branch: branch || 'main',
      lastCommit: lastCommit || 'No commits',
      workingTree: status || 'Clean',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'error', 
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============ PUSH NOTIFICATION ROUTES ============

// POST /api/push-subscribe - Subscribe to push notifications
app.post('/api/push-subscribe', (req, res) => {
  try {
    const { subscription, settings } = req.body;
    if (!subscription) {
      return res.status(400).json({ success: false, error: 'Subscription required' });
    }
    
    // Save subscription with settings to file
    let subscriptions = [];
    const subsFile = 'logs/push-subscriptions.json';
    if (fs.existsSync(subsFile)) {
      const content = fs.readFileSync(subsFile, 'utf8').trim();
      if (content) {
        try {
          subscriptions = JSON.parse(content);
          if (!Array.isArray(subscriptions)) subscriptions = [];
        } catch (e) {
          subscriptions = [];
        }
      }
    }
    
    // Add or update subscription
    const existingIndex = subscriptions.findIndex(s => s.subscription.endpoint === subscription.endpoint);
    if (existingIndex >= 0) {
      subscriptions[existingIndex] = { subscription, settings, updatedAt: new Date().toISOString() };
    } else {
      subscriptions.push({ subscription, settings, subscribedAt: new Date().toISOString() });
    }
    
    fs.writeFileSync(subsFile, JSON.stringify(subscriptions, null, 2));
    res.json({ success: true, message: 'Subscribed to push notifications' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/check-price-alert - Check if price moved and send notifications
app.post('/api/check-price-alert', (req, res) => {
  try {
    const { ticker, currentPrice, alertPrice } = req.body;
    if (!ticker || !currentPrice || !alertPrice) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    const change = ((currentPrice - alertPrice) / alertPrice * 100);
    
    // Load subscriptions and send to those who enabled push
    const subsFile = 'logs/push-subscriptions.json';
    if (fs.existsSync(subsFile)) {
      const content = fs.readFileSync(subsFile, 'utf8').trim();
      if (content) {
        try {
          const subscriptions = JSON.parse(content);
          subscriptions.forEach(sub => {
            const settings = sub.settings || {};
            if (!settings.enabled) return;
            
            const absChange = Math.abs(change);
            const threshold = settings.threshold || 5;
            
            if (absChange >= threshold) {
              // Check direction and type filters
              if (settings.type === 'up' && change < 0) return;
              if (settings.type === 'down' && change > 0) return;
              
              // Send push notification (in production, use web-push library)
              log('INFO', `Price Alert: ${ticker} ${change > 0 ? 'UP' : 'DOWN'} ${Math.abs(change).toFixed(2)}% - Sub endpoint: ${sub.subscription.endpoint.substring(0, 50)}...`);
            }
          });
        } catch (e) {
          log('WARN', `Failed to process push subscriptions: ${e.message}`);
        }
      }
    }
    
    res.json({ success: true, change, threshold: req.body.threshold || 5 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ EMAIL AUTHENTICATION ROUTES ============

// POST /api/auth-send-code - Send OTP email
app.post('/api/auth-send-code', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }
    
    // Validate email format: must have @ and a valid domain with at least one dot
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    
    const emailLower = email.toLowerCase();
    
    const otp = generateOTP();
    const now = Date.now();
    pendingEmails.set(emailLower, {
      code: otp,
      createdAt: now,
      attempts: 0
    });
    
    // OTP expires in 15 minutes
    setTimeout(() => {
      if (pendingEmails.get(emailLower)?.createdAt === now) {
        pendingEmails.delete(emailLower);
      }
    }, 15 * 60 * 1000);
    
    const sent = await sendOTPEmail(email, otp);
    
    // Log OTP request to auth log
    const authLogEntry = {
      ...analyzeTraffic(req, `otp_${Date.now()}`),
      email: emailLower,
      authMethod: 'otp-request',
      decision: 'pending',
      otpSent: sent,
      createdAt: new Date().toISOString()
    };
    appendAuthLog(authLogEntry);
    
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/auth-send-code:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /auth-verify - Verify code page
app.get('/auth-verify', (req, res) => {
  const email = req.query.email || '';
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enter Access Code</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Poppins', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 400px;
      width: 100%;
    }
    h1 {
      font-size: 24px;
      color: #333;
      margin-bottom: 10px;
      font-weight: 600;
    }
    .subtitle {
      color: #666;
      font-size: 14px;
      margin-bottom: 30px;
    }
    input {
      width: 100%;
      padding: 12px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 20px;
      font-family: 'Courier New', monospace;
      text-align: center;
      letter-spacing: 8px;
      transition: border-color 0.3s;
      margin-bottom: 20px;
      text-transform: uppercase;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      font-family: 'Poppins', sans-serif;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .error {
      color: #d32f2f;
      font-size: 13px;
      margin-bottom: 15px;
      display: none;
    }
    .email-confirm {
      font-size: 13px;
      color: #667eea;
      font-weight: 600;
      margin-bottom: 20px;
      padding: 10px;
      background: #f5f5f5;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Enter Access Code</h1>
    <p class="subtitle">Check your email for the 6-character code</p>
    <div class="email-confirm">${email}</div>
    <div class="error" id="error"></div>
    <input type="text" id="code" placeholder="000000" autocomplete="off" maxlength="6">
    <button onclick="verify()" id="btn">Verify Code</button>
  </div>
  <script>
    const email = '${email.replace(/'/g, "\\'")}';
    
    async function verify() {
      const code = document.getElementById('code').value.trim().toUpperCase();
      const error = document.getElementById('error');
      const btn = document.getElementById('btn');
      error.style.display = 'none';
      
      if (!code || code.length !== 6) {
        error.textContent = 'Please enter a 6-character code';
        error.style.display = 'block';
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      
      try {
        const r = await fetch('/api/auth-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });
        const data = await r.json();
        
        if (data.success) {
          // Redirect to dashboard or main page
          window.location.href = '/';
        } else {
          error.textContent = data.error || 'Invalid code';
          error.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Verify Code';
        }
      } catch (err) {
        error.textContent = 'Network error';
        error.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Verify Code';
      }
    }
    
    document.getElementById('code').addEventListener('keypress', e => {
      if (e.key === 'Enter') verify();
    });
    
    // Focus code input
    document.getElementById('code').focus();
  </script>
</body>
</html>
  `);
});

// POST /api/login-verify - Verify email and password for registered account or admin
app.post('/api/login-verify', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.json({ success: false, error: 'Email and password required' });
  
  const emailLower = email.toLowerCase();
  
  // Check for admin credentials
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cc';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (emailLower === adminEmail.toLowerCase() && password === adminPassword) {
    log('AUTH', `Admin login verified for ${emailLower}`);
    return res.json({ success: true, message: 'Admin verified', isAdmin: true });
  }
  
  const user = registeredUsers.get(emailLower);
  
  // Check if account exists
  if (!user) {
    log('AUTH', `Login failed: Account not registered for ${emailLower}`);
    return res.json({ success: false, error: 'Account not found. Please create an account first.' });
  }
  
  // Verify password
  const crypto = require('crypto');
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  if (user.passwordHash !== passwordHash) {
    log('AUTH', `Login failed: Invalid password for ${emailLower}`);
    return res.json({ success: false, error: 'Invalid password' });
  }
  
  log('AUTH', `Login credentials verified for ${emailLower}`);
  res.json({ success: true, message: 'Credentials verified' });
});

// RATE LIMITING - Prevent brute force attacks
const loginAttempts = new Map(); // { ip: { count, timestamp } }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW = 15 * 60 * 1000; // 15 minutes

const checkRateLimit = (ip) => {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  
  if (!record) {
    loginAttempts.set(ip, { count: 0, timestamp: now });
    return true;
  }
  
  // Reset if window expired
  if (now - record.timestamp > LOCKOUT_WINDOW) {
    loginAttempts.set(ip, { count: 0, timestamp: now });
    return true;
  }
  
  // Check if locked out
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    return false;
  }
  
  return true;
};

const incrementLoginAttempt = (ip) => {
  const record = loginAttempts.get(ip);
  if (record) record.count++;
};

// POST /api/auth-verify - Verify purchase code and create session (or admin bypass)
app.post('/api/auth-verify', (req, res) => {
  const { email, password, code } = req.body || {};
  if (!email || !password || !code) return res.json({ success: false, error: 'Missing email, password, or code' });
  
  const emailLower = email.toLowerCase();
  const purchaseCode = code.trim().toUpperCase();
  
  // Get client info for logging all attempts
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '0.0.0.0';
  const fingerprint = getClientFingerprint(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  // Check rate limit
  if (!checkRateLimit(clientIp)) {
    log('SECURITY', `Rate limit exceeded for IP ${clientIp}. Locked out for ${LOCKOUT_WINDOW / 1000 / 60} minutes`);
    return res.status(429).json({ success: false, error: 'Too many login attempts. Please try again later.' });
  }
  
  // Check for admin credentials
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cc';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const adminCode = process.env.ADMIN_CODE || 'ADMINS3CR3T';
  
  if (emailLower === adminEmail.toLowerCase() && password === adminPassword && purchaseCode === adminCode) {
    // Reset rate limit on successful login
    loginAttempts.delete(clientIp);
    log('AUTH', `Admin login successful for ${emailLower}`);
    log('AUTH', `IP: ${clientIp} Device: ${fingerprint}`);
    console.log('');
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, true, 'Admin login successful');
    
    const sessionId = generateSessionId();
    approvedSessions.add(sessionId);
    
    // Create admin session
    const metadata = getClientMetadata(req);
    
    pendingLogins.set(sessionId, {
      email: adminEmail,
      ip: clientIp,
      country: metadata.country || 'Unknown',
      userAgent: userAgent,
      time: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      userAccepted: true,
      isAdmin: true
    });
    
    // Set session cookie
    res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600`);
    return res.json({ success: true, sessionId, isAdmin: true });
  }
  
  // Check if account exists
  const registeredUser = registeredUsers.get(emailLower);
  if (!registeredUser) {
    log('AUTH', `Auth failed: Account not registered for ${emailLower}`);
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Account not registered', '', '');
    return res.json({ success: false, error: 'Account not found. Please create an account first.' });
  }
  
  // Verify password (using bcrypt if available, fallback to SHA256 for legacy)
  let passwordMatch = false;
  if (registeredUser.passwordHash && registeredUser.passwordHash.startsWith('$2')) {
    // bcrypt hash (starts with $2)
    try {
      passwordMatch = bcrypt.compareSync(password, registeredUser.passwordHash);
    } catch (e) {
      log('WARN', `Bcrypt compare failed for ${emailLower}: ${e.message}`);
      passwordMatch = false;
    }
  } else {
    // Legacy SHA256 hash
    const crypto = require('crypto');
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    passwordMatch = registeredUser.passwordHash === passwordHash;
  }
  
  if (!passwordMatch) {
    incrementLoginAttempt(clientIp);
    log('AUTH', `Auth failed: Invalid password for ${emailLower}`);
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Invalid password', registeredUser.fullName, registeredUser.company);
    return res.json({ success: false, error: 'Invalid password' });
  }
  
  // Reset rate limit on successful password verification
  loginAttempts.delete(clientIp);
  
  // Check if purchase code exists and is valid for this email
  const codeData = purchaseCodes.get(purchaseCode);
  
  if (!codeData) {
    incrementLoginAttempt(clientIp);
    log('AUTH', `Auth failed: Invalid code for ${emailLower}`);
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Invalid code', registeredUser.fullName, registeredUser.company);
    return res.json({ success: false, error: 'Invalid access code' });
  }
  
  // Check if code has already been used
  if (codeData.used) {
    log('AUTH', `Auth failed: Code already used for ${emailLower}`);
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Code already used', registeredUser.fullName, registeredUser.company);
    return res.json({ success: false, error: 'This access code has already been used' });
  }
  
  // Check if code matches the email provided
  if (codeData.email.toLowerCase() !== emailLower) {
    log('AUTH', `Auth failed: Code mismatch for ${emailLower} (code for ${codeData.email})`);
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Code mismatch', registeredUser.fullName, registeredUser.company);
    return res.json({ success: false, error: 'Access code does not match this email' });
  }
  
  // Code is valid - create session and auto-approve
  const sessionId = generateSessionId();
  const metadata = getClientMetadata(req);
  
  pendingLogins.set(sessionId, {
    email: emailLower,
    ip: metadata.ip,
    country: metadata.country,
    userAgent: metadata.userAgent,
    time: new Date().toISOString(),
    headers: metadata.headers,
    createdAt: new Date().toISOString(),
    userAccepted: true // User accepted by entering correct code
  });
  
  // Auto-approve after successful code verification
  approvedSessions.add(sessionId);
  
  // Mark purchase code as used
  codeData.used = true;
  codeData.usedAt = new Date().toISOString();
  codeData.usedBy = sessionId;
  
  lastPendingSessionId = sessionId;
  
  // Log session activity
  const location = metadata.country || 'Unknown';
  logSession(emailLower, sessionId, clientIp, userAgent, location);
  
  // Log successful login attempt to data.json
  logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, true, 'Successful login - code validated', registeredUser.fullName, registeredUser.company);
  
  // Mark user as paid (they have a valid purchase code)
  const user = registeredUsers.get(emailLower);
  if (user) {
    user.paid = true;
    saveUsers();
  }
  
  const message = `Session approved=${sessionId} email: ${emailLower} via purchase code ${purchaseCode}`;
  log('AUTH', message);
  
  // Save to auth log with email
  const authLogEntry = {
    ...analyzeTraffic(req, sessionId),
    email: emailLower,
    authMethod: 'purchase-code',
    decision: 'approved',
    approvedAt: new Date().toISOString()
  };
  appendAuthLog(authLogEntry);
  
  // Set session cookie
  res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600`);
  res.json({ success: true, sessionId });
});

// POST /api/auth-register - Register new user with email, password, name, and access code
app.post('/api/auth-register', async (req, res) => {
  try {
    const { email, password, fullName, company, accessCode } = req.body || {};
    
    // Get client info for logging
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '0.0.0.0';
    const fingerprint = getClientFingerprint(req);
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }
    
    const emailLower = email.toLowerCase();
    
    // Check if user already exists
    if (registeredUsers.has(emailLower)) {
      logLoginAttempt(emailLower, password, accessCode, clientIp, fingerprint, userAgent, false, 'Email already registered', fullName, company);
      return res.status(400).json({ success: false, error: 'Email already registered' });
    }
    
    // Validate password
    if (!password || password.length < 6) {
      logLoginAttempt(emailLower, password, accessCode, clientIp, fingerprint, userAgent, false, 'Password too short', fullName, company);
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    // Check password requirements: capital letter, number, punctuation
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasPunctuation = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    
    if (!hasUppercase || !hasNumber || !hasPunctuation) {
      logLoginAttempt(emailLower, password, accessCode, clientIp, fingerprint, userAgent, false, 'Password does not meet requirements', fullName, company);
      return res.status(400).json({ success: false, error: 'Password must contain uppercase letter, number, and special character' });
    }
    
    // Validate full name
    if (!fullName || fullName.length < 2) {
      logLoginAttempt(emailLower, password, accessCode, clientIp, fingerprint, userAgent, false, 'Invalid name', fullName, company);
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    
    // Validate access code
    if (!accessCode) {
      logLoginAttempt(emailLower, password, accessCode, clientIp, fingerprint, userAgent, false, 'No access code provided', fullName, company);
      return res.status(400).json({ success: false, error: 'Access code required' });
    }
    
    // Check if access code is valid
    const purchaseCode = accessCode.trim().toUpperCase();
    const codeData = purchaseCodes.get(purchaseCode);
    
    if (!codeData) {
      log('AUTH', `Registration failed: Invalid access code for ${emailLower}`);
      logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Invalid access code', fullName, company);
      return res.status(400).json({ success: false, error: 'Invalid access code' });
    }
    
    // Check if code has already been used
    if (codeData.used) {
      log('AUTH', `Registration failed: Access code already used for ${emailLower}`);
      logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Access code already used', fullName, company);
      return res.status(400).json({ success: false, error: 'This access code has already been used' });
    }
    
    // Check if code matches the email provided
    if (codeData.email.toLowerCase() !== emailLower) {
      log('AUTH', `Registration failed: Code mismatch for ${emailLower} (code for ${codeData.email})`);
      logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, false, 'Code mismatch', fullName, company);
      return res.status(400).json({ success: false, error: 'Access code does not match this email' });
    }
    
    // All validations passed - create the account
    // Hash password using bcrypt (async)
    let passwordHash;
    try {
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password, salt);
    } catch (hashErr) {
      log('WARN', `Bcrypt hashing failed: ${hashErr.message}. Falling back to SHA256`);
      // Fallback to SHA256 if bcrypt fails
      const crypto = require('crypto');
      passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    }
    
    registeredUsers.set(emailLower, {
      email: emailLower,
      fullName,
      company: company || '',
      passwordHash,
      paid: true, // Mark as paid since they have valid access code
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    });
    
    saveUsers();
    
    // Mark access code as used
    codeData.used = true;
    codeData.usedAt = new Date().toISOString();
    
    // Create session
    const sessionId = generateSessionId();
    const metadata = getClientMetadata(req);
    
    approvedSessions.add(sessionId);
    
    const location = metadata.country || 'Unknown';
    logSession(emailLower, sessionId, clientIp, userAgent, location);
    
    // Log successful registration
    logLoginAttempt(emailLower, password, purchaseCode, clientIp, fingerprint, userAgent, true, 'Registration successful - account created', fullName, company);
    
    log('AUTH', `Registration successful for ${emailLower}`);
    
    log('AUTH', `New user registered: ${emailLower} with access code`);
    
    // Set session cookie
    res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600`);
    res.json({ success: true, message: 'Account created successfully' });
    
  } catch (err) {
    console.error('Error in /api/auth-register:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/auth-verify-register - Verify registration and create account
app.post('/api/auth-verify-register', async (req, res) => {
  try {
    const { email, code, password, fullName, company } = req.body || {};
    
    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and code required' });
    }
    
    const emailLower = email.toLowerCase();
    const pending = pendingEmails.get(emailLower);
    
    if (!pending || !pending.isRegistration) {
      return res.status(400).json({ success: false, error: 'Invalid registration request' });
    }
    
    if (pending.code !== code.toUpperCase()) {
      pending.attempts = (pending.attempts || 0) + 1;
      if (pending.attempts >= 3) {
        pendingEmails.delete(emailLower);
        return res.status(400).json({ success: false, error: 'Too many attempts. Please request a new code.' });
      }
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }
    
    // Create user account
    const hashedPassword = require('crypto').createHash('sha256').update(password).digest('hex');
    const newUser = {
      email: emailLower,
      fullName,
      company: company || '',
      passwordHash: hashedPassword,
      createdAt: new Date().toISOString(),
      lastLogin: null
    };
    
    registeredUsers.set(emailLower, newUser);
    saveUsers();
    
    // Clean up pending code
    pendingEmails.delete(emailLower);
    
    // Log registration
    log('AUTH', `New user registered: ${emailLower} (${fullName})`);
    
    // Create session immediately after registration
    const sessionId = generateSessionId();
    approvedSessions.add(sessionId);
    
    // Log session activity
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '0.0.0.0';
    logSession(emailLower, sessionId, clientIp, userAgent, 'Registration');
    
    // Set session cookie and redirect to dashboard
    res.setHeader('Set-Cookie', `sid=${sessionId}; HttpOnly; Path=/; SameSite=Lax; Max-Age=3600`);
    res.json({ success: true, sessionId });
  } catch (err) {
    console.error('Error in /api/auth-verify-register:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/auth-status - Check if session is approved
app.get('/api/auth-status', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid;
  
  if (!sessionId) {
    return res.json({ status: 'unauthenticated' });
  }
  
  if (approvedSessions.has(sessionId)) {
    return res.json({ status: 'approved' });
  }
  
  if (deniedSessions.has(sessionId)) {
    return res.json({ status: 'denied' });
  }
  
  return res.json({ status: 'pending' });
});

// POST /api/accept-terms - User accepts terms and enters waiting for approval
app.post('/api/accept-terms', (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId || !pendingLogins.has(sessionId)) {
    return res.status(400).json({ success: false, error: 'Invalid session' });
  }
  
  const login = pendingLogins.get(sessionId);
  login.userAccepted = true;
  
  log('AUTH', `User accepted terms for session=${sessionId}`);
  if (hasInteractivePrompt && rl) rl.prompt();
  
  res.json({ success: true });
});

// GET /api/user-sessions - Get user's active sessions
app.get('/api/user-sessions', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid;
  
  if (!sessionId || !approvedSessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  // Find which user owns this session
  let userEmail = null;
  for (const [email, sessions] of userSessions) {
    if (sessions.some(s => s.sessionId === sessionId)) {
      userEmail = email;
      break;
    }
  }
  
  if (!userEmail) {
    return res.status(401).json({ success: false, error: 'Session not found' });
  }
  
  const activeSessions = getUserSessions(userEmail);
  res.json({ 
    success: true, 
    sessions: activeSessions.map(s => ({
      sessionId: s.sessionId,
      ip: s.ip,
      location: s.location,
      device: s.userAgent,
      loginTime: s.loginTime,
      lastActivity: s.lastActivity
    }))
  });
});

// POST /api/logout-session - Logout a specific session
app.post('/api/logout-session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid;
  const { targetSessionId } = req.body || {};
  
  if (!sessionId || !approvedSessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  // Find user email
  let userEmail = null;
  for (const [email, sessions] of userSessions) {
    if (sessions.some(s => s.sessionId === sessionId)) {
      userEmail = email;
      break;
    }
  }
  
  if (!userEmail) {
    return res.status(401).json({ success: false, error: 'Session not found' });
  }
  
  // Remove target session
  if (targetSessionId) {
    const sessions = userSessions.get(userEmail) || [];
    const filtered = sessions.filter(s => s.sessionId !== targetSessionId);
    userSessions.set(userEmail, filtered);
    saveSessions();
    
    // Also remove from approvedSessions
    approvedSessions.delete(targetSessionId);
    
    log('AUTH', `Session logged out: ${targetSessionId} for ${userEmail}`);
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, error: 'Session ID required' });
  }
});

// POST /api/logout-all-sessions - Logout all other sessions
app.post('/api/logout-all-sessions', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies.sid;
  
  if (!sessionId || !approvedSessions.has(sessionId)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  // Find user email
  let userEmail = null;
  for (const [email, sessions] of userSessions) {
    if (sessions.some(s => s.sessionId === sessionId)) {
      userEmail = email;
      break;
    }
  }
  
  if (!userEmail) {
    return res.status(401).json({ success: false, error: 'Session not found' });
  }
  
  // Get all sessions except current
  const sessions = userSessions.get(userEmail) || [];
  const otherSessions = sessions.filter(s => s.sessionId !== sessionId);
  
  // Remove all other sessions
  for (const session of otherSessions) {
    approvedSessions.delete(session.sessionId);
  }
  
  // Keep only current session
  userSessions.set(userEmail, sessions.filter(s => s.sessionId === sessionId));
  saveSessions();
  
  log('AUTH', `All other sessions logged out for ${userEmail}`);
  res.json({ success: true, message: 'All other sessions signed out' });
});

// POST /api/generate-purchase-code - Generate access code for customer (admin only via manual input)
app.post('/api/generate-purchase-code', (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, error: 'Email required' });
  
  const emailLower = email.toLowerCase();
  const purchaseCode = generateOTP() + generateOTP(); // Longer code for purchase
  
  purchaseCodes.set(purchaseCode, {
    email: emailLower,
    createdAt: new Date().toISOString(),
    used: false,
    usedAt: null,
    usedBy: null
  });
  
  const message = `Purchase code generated for ${emailLower}: ${purchaseCode}`;
  log('ADMIN', message);
  res.json({ success: true, purchaseCode, email: emailLower });
});

// GET /api/purchase-codes - List all purchase codes (debug only)
app.get('/api/purchase-codes', (req, res) => {
  const codes = Array.from(purchaseCodes.entries()).map(([code, data]) => ({
    code,
    email: data.email,
    createdAt: data.createdAt,
    used: data.used,
    usedAt: data.usedAt
  }));
  res.json({ purchaseCodes: codes });
});

// ============ END EMAIL AUTHENTICATION ROUTES ============

// GET /admin/codes - Admin panel for generating purchase codes
app.get('/admin/codes', (req, res) => {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Code Generator</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Poppins', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 600px;
      width: 100%;
    }
    h1 {
      font-size: 28px;
      color: #000;
      margin-bottom: 30px;
      text-align: center;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #333;
    }
    input {
      width: 100%;
      padding: 12px 15px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      font-family: 'Poppins', sans-serif;
      transition: border-color 0.3s;
    }
    input:focus {
      outline: none;
      border-color: #666;
    }
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #888888 0%, #666666 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      font-family: 'Poppins', sans-serif;
    }
    button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(100, 100, 100, 0.3);
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .result {
      margin-top: 30px;
      padding: 20px;
      background: #f5f5f5;
      border-radius: 8px;
      display: none;
    }
    .result.success {
      background: #e8f5e9;
      border: 2px solid #4caf50;
      display: block;
    }
    .result.error {
      background: #ffebee;
      border: 2px solid #f44336;
      display: block;
    }
    .code-box {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-top: 10px;
      font-family: monospace;
      font-size: 16px;
      word-break: break-all;
      border: 2px solid #ddd;
      cursor: pointer;
    }
    .code-box:hover {
      background: #f9f9f9;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Generate Purchase Code</h1>
    <div class="form-group">
      <label for="email">Customer Email:</label>
      <input type="email" id="email" placeholder="customer@example.com">
    </div>
    <button onclick="generateCode()">Generate Access Code</button>
    <div class="result" id="result"></div>
  </div>
  
  <script>
    function generateCode() {
      const email = document.getElementById('email').value.trim();
      const result = document.getElementById('result');
      
      if (!email) {
        result.textContent = 'Please enter an email address';
        result.className = 'result error';
        return;
      }
      
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        result.textContent = 'Please enter a valid email address';
        result.className = 'result error';
        return;
      }
      
      fetch('/api/generate-purchase-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          result.innerHTML = '<strong style="color: #4caf50;">✓ Code generated successfully!</strong>' +
            '<p style="margin-top: 10px; margin-bottom: 5px;">Email: <strong>' + data.email + '</strong></p>' +
            '<p style="margin-bottom: 10px;">Access Code:</p>' +
            '<div class="code-box" onclick="copyCode(this)">' + data.purchaseCode + '</div>' +
            '<p style="font-size: 12px; color: #666; margin-top: 10px;">Click code to copy</p>';
          result.className = 'result success';
          document.getElementById('email').value = '';
        } else {
          result.textContent = 'Error: ' + (data.error || 'Unknown error');
          result.className = 'result error';
        }
      })
      .catch(err => {
        result.textContent = 'Error: ' + err.message;
        result.className = 'result error';
      });
    }
    
    function copyCode(element) {
      const text = element.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const original = element.textContent;
        element.textContent = '✓ Copied!';
        setTimeout(() => {
          element.textContent = original;
        }, 2000);
      });
    }
    
    document.getElementById('email').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') generateCode();
    });
  </script>
</body>
</html>`;
  res.send(html);
});

// ============ END EMAIL AUTHENTICATION ROUTES ============

app.get('/', (req, res) => {
  res.sendFile('./docs/index.html', { root: '.' });
});

app.use(express.static('./docs'));

// Quote endpoint with Yahoo → FMP → Finnhub fallback (PUBLIC - no auth required)
app.post('/api/clear-alerts', (req, res) => {
  try {
    const alertsFile = CONFIG.ALERTS_FILE;
    // Write empty array to alerts file
    fs.writeFileSync(alertsFile, '[]');
    res.json({ success: true, message: 'Alerts cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Title and message required' });
    }

    // Get the user's email from the session
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionId = cookies.sid;
    const sessionData = pendingLogins.get(sessionId);
    const userEmail = 'foundereugene1@gmail.com';

    const html = `
<html>
<body style="font-family: Arial, sans-serif; color: #333;">
  <div style="max-width: 600px; margin: 0 auto;">
    <h2 style="color: #667eea;">Message</h2>
    <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h3 style="color: #667eea; margin-top: 0;">${title}</h3>
      <p style="line-height: 1.6; white-space: pre-wrap;">${message}</p>
    </div>
    <p style="font-size: 11px; color: #999;">Sent from Carlucci Capital Dashboard</p>
  </div>
</body>
</html>
    `;

    // Try to send email, but don't fail if it doesn't work
    await sendMailtrapEmail(userEmail, `Inbox Message: ${title}`, html).catch(err => {
      console.error('Message email send failed (non-blocking):', err.message);
    });

    // Always return success
    res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    log('ERROR', `Failed to send message: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                  PAYMENT & ACCESS CODE DISTRIBUTION FLOW                     ║
╚══════════════════════════════════════════════════════════════════════════════╝

CURRENT ARCHITECTURE:
1. User clicks "Request Access" button in login modal
2. User fills form (name, email, interest message, optional source)
3. Form submits to /api/send-access-request endpoint
4. Email notification sent to business admin
5. Admin manually reviews request and issues ACCESS CODE

PAYMENT INTEGRATION (FUTURE):
- Phase 1: Manual payment requests + admin code issuance (current)
- Phase 2: Stripe payment integration
  • Add "Get Premium Access" button to Request Access modal
  • Redirect to Stripe Checkout session
  • Webhook listens to payment.succeeded event
  • Create random 12-char access code (uppercase alphanumeric)
  • Email code to user automatically
  • Store code in database with user email, payment date, expiry (180 days)

CODE GENERATION ALGORITHM:
  function generateAccessCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 12; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

WEBHOOK HANDLER (Stripe):
  app.post('/api/webhook/stripe-payment', (req, res) => {
    const event = req.body;
    if (event.type === 'payment_intent.succeeded') {
      const email = event.data.object.customer_email;
      const code = generateAccessCode();
      saveAccessCode(email, code); // Save to database
      sendCodeByEmail(email, code); // Send via SMTP
      res.json({ received: true });
    }
  });

CURRENT FLOW DATA:
- Access requests stored as emails to admin
- Codes issued manually via admin panel
- No automatic tracking of who has codes
- No code expiration management
- No revenue attribution

NEXT STEPS:
1. Set up Stripe account and API keys
2. Create /api/webhook/stripe-payment endpoint
3. Add database table: access_codes (email, code, created_date, expires_date, payment_id)
4. Update Request Access modal with pricing/subscribe button
5. Implement automatic email delivery on payment confirmation

SECURITY NOTES:
- Codes are UPPERCASE ONLY (case-insensitive comparison on server)
- 12 characters provides ~62^12 combinations (safe from brute force)
- Trim whitespace before comparison
- Require valid email format for code registration
- Log all code generation and usage for audit
*/

app.post('/api/send-access-request', async (req, res) => {
  try {
    const { name, email, source, message } = req.body;
    
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, error: 'Name, email, and message are required' });
    }

    // Validate email format - permissive regex that accepts valid email formats
    const emailRegex = /^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    }

    // Business email to send to
    const businessEmail = 'foundereugene1@gmail.com';
    
    const html = `
<html>
<body style="font-family: 'Poppins', Arial, sans-serif; color: #333; background-color: #f9f9f9;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);">
      <h2 style="color: #2c2c2c; margin-bottom: 5px;">New Access Request</h2>
      <p style="color: #999; margin-top: 0; font-size: 13px;">From Carlucci Capital Portal</p>
      <hr style="border: none; border-top: 2px solid #f0f0f0; margin: 20px 0;">
      
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 0 0 10px 0;"><strong>Name:</strong></p>
        <p style="margin: 0 0 15px 0; color: #666;">${name}</p>
        
        <p style="margin: 0 0 10px 0;"><strong>Email:</strong></p>
        <p style="margin: 0 0 15px 0; color: #666;"><a href="mailto:${email}" style="color: #667eea; text-decoration: none;">${email}</a></p>
        
        ${source ? `<p style="margin: 0 0 10px 0;"><strong>How they heard about us:</strong></p>
        <p style="margin: 0 0 15px 0; color: #666;">${source}</p>` : ''}
        
        ${message ? `<p style="margin: 0 0 10px 0;"><strong>Message:</strong></p>
        <p style="margin: 0; color: #666; line-height: 1.6; white-space: pre-wrap;">${message}</p>` : ''}
      </div>
      
      <p style="font-size: 12px; color: #999; text-align: center; margin-top: 20px;">
        This is an automated message. Please respond to the applicant's email address above.
      </p>
    </div>
  </div>
</body>
</html>
    `;

    // Save application to local file as backup
    try {
      const applications = [];
      const appFile = 'logs/applications.json';
      if (fs.existsSync(appFile)) {
        const content = fs.readFileSync(appFile, 'utf8');
        try {
          applications.push(...JSON.parse(content));
        } catch (e) {
          // File might be empty or corrupted
        }
      }
      applications.push({
        timestamp: new Date().toISOString(),
        name,
        email,
        message,
        source
      });
      fs.writeFileSync(appFile, JSON.stringify(applications, null, 2));
    } catch (err) {
      console.error('Failed to save application locally:', err.message);
    }

    // Try to send email via Mailtrap
    sendMailtrapEmail(businessEmail, `New Access Request from ${name}`, html).catch(err => {
      log('ERROR', `Email sending error: ${err.message}`);
    });

    // Always return success so user sees confirmation
    res.json({ success: true, message: 'Access request submitted successfully' });
  } catch (err) {
    console.error('ERROR: Failed to process access request:', err.message);
    res.status(500).json({ success: false, error: 'Failed to submit request' });
  }
});

app.get('/api/ping', (req, res) => {
  try {
    res.json({ status: 'online', onlineUsers: 1 });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Background task to update performance data for all tracked stocks
const updateAllPerformanceData = async () => {
  try {
    if (!fs.existsSync(CONFIG.PERFORMANCE_FILE)) return;
    
    const perfContent = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
    if (!perfContent) return;
    
    let performanceData = {};
    try {
      performanceData = JSON.parse(perfContent);
      if (!performanceData || typeof performanceData !== 'object') return;
    } catch (e) {
      return;
    }
    
    let updated = false;
    
    // Update each tracked stock with delay to avoid rate limits
    for (const ticker of Object.keys(performanceData)) {
      try {
        const quote = await yahooFinance.quote(ticker, {
          fields: ['regularMarketPrice'],
        }).catch(() => null);
        
        if (quote && quote.regularMarketPrice && quote.regularMarketPrice > 0) {
          const currentPrice = quote.regularMarketPrice;
          performanceData[ticker].currentPrice = currentPrice;
          
          // Track highest/lowest
          if (currentPrice > (performanceData[ticker].highest || 0)) {
            performanceData[ticker].highest = currentPrice;
          }
          if (currentPrice < (performanceData[ticker].lowest || currentPrice)) {
            performanceData[ticker].lowest = currentPrice;
          }
          
          // Recalculate performance
          const alertPrice = performanceData[ticker].alert;
          if (alertPrice > 0) {
            const change = currentPrice - alertPrice;
            const percentChange = (change / alertPrice) * 100;
            performanceData[ticker].performance = parseFloat(percentChange.toFixed(2));
          }
          
          updated = true;
        }
      } catch (e) {
        // Silently skip individual ticker errors
      }
      
      // Add small delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // Write back if any updates were made
    if (updated) {
      try {
        const tempFile = CONFIG.PERFORMANCE_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(performanceData, null, 2));
        fs.renameSync(tempFile, CONFIG.PERFORMANCE_FILE);
      } catch (err) {
        fs.writeFileSync(CONFIG.PERFORMANCE_FILE, JSON.stringify(performanceData, null, 2));
      }
    }
  } catch (e) {
    // Silently fail background update
  }
};

// Run performance update every 30 seconds
setInterval(updateAllPerformanceData, 30000);

// Sync all peak data to stocks.json every 10 seconds
setInterval(syncAllPeakData, 10000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  log('INFO', `App: Dashboard online at https://www.eugenes.shop & http://localhost:${PORT}`);
});

// Initialize readline for terminal commands if interactive
if (process.stdin.isTTY) {
  const readline = require('readline');
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });
  hasInteractivePrompt = true;
  
  rl.on('line', (input) => {
    const cmd = input.trim().toLowerCase().split(/\s+/)[0];
    const args = input.trim().split(/\s+/).slice(1);
    
    if (cmd === 'yes' && lastPendingSessionId && pendingLogins.has(lastPendingSessionId)) {
      approvedSessions.add(lastPendingSessionId);
      const login = pendingLogins.get(lastPendingSessionId);
      pendingLogins.delete(lastPendingSessionId);
      log('AUTH', `Approved session=${lastPendingSessionId} from ${login.ip}`);
      lastPendingSessionId = null;
    } else if (cmd === 'no' && lastPendingSessionId && pendingLogins.has(lastPendingSessionId)) {
      deniedSessions.add(lastPendingSessionId);
      const login = pendingLogins.get(lastPendingSessionId);
      pendingLogins.delete(lastPendingSessionId);
      log('AUTH', `Denied session=${lastPendingSessionId} from ${login.ip}`);
      lastPendingSessionId = null;
    } else if (cmd === 'approve' && args[0]) {
      const sessionId = args[0];
      const fullId = [...pendingLogins.keys()].find(s => s.startsWith(sessionId)) || sessionId;
      if (pendingLogins.has(fullId)) {
        approvedSessions.add(fullId);
        const login = pendingLogins.get(fullId);
        pendingLogins.delete(fullId);
        log('AUTH', `Approved session=${fullId} from ${login.ip}`);
        if (fullId === lastPendingSessionId) lastPendingSessionId = null;
      }
    } else if (cmd === 'deny' && args[0]) {
      const sessionId = args[0];
      const fullId = [...pendingLogins.keys()].find(s => s.startsWith(sessionId)) || sessionId;
      if (pendingLogins.has(fullId)) {
        deniedSessions.add(fullId);
        const login = pendingLogins.get(fullId);
        pendingLogins.delete(fullId);
        log('AUTH', `Denied session=${fullId} from ${login.ip}`);
        if (fullId === lastPendingSessionId) lastPendingSessionId = null;
      }
    } else if (cmd === 'list') {
      if (pendingLogins.size === 0) {
        log('AUTH', 'No pending logins');
      } else {
        log('AUTH', 'Pending logins:');
        let idx = 0;
        for (const [sessionId, login] of pendingLogins) {
          log('AUTH', `  [${idx}] ${login.ip} - ${sessionId.substring(0, 8)}... - ${login.time}`);
          idx++;
        }
      }
    } else if (cmd === 'help') {
      log('AUTH', 'Commands: yes, no, approve <id>, deny <id>, list, help');
    }
  });
}

(async () => {
  let cycleCount = 0, alertsSent = 0, startTime = Date.now();
  let processedHashes = new Map(); // Pure in-memory, session-based (100 max)
  let alertedTickers = new Set(); // Track tickers alerted in current cycle to prevent duplicates
  let loggedFetch = false;
  
  try {
    const projectRoot = '/home/user/Documents/sysd';
    const branch = execSync(`cd ${projectRoot} && git rev-parse --abbrev-ref HEAD`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || 'main';
    const lastCommit = execSync(`cd ${projectRoot} && git log -1 --pretty=format:"%h - %s (%ai)"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || 'No commits';
    log('INFO', `Git: Last commit: ${lastCommit}`);
  } catch (err) {
  }
    
 while (true) {
    try {
      cycleCount++;
      alertedTickers.clear(); // Reset per cycle to allow re-alerts from new filings
      const filings6K = await Promise.race([
        fetchFilings(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fetch timeout')), 30000))
      ]).catch(() => []);
      const filings8K = await Promise.race([
        fetch8Ks(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('fetch timeout')), 30000))
      ]).catch(() => []);
      const allFilings = [...filings6K, ...filings8K];
      
      // Log only if there are new filings and we haven't logged this batch yet
      let newFilingFound = false;
      for (const filing of allFilings) {
        const hash = crypto.createHash('md5').update(filing.title + filing.updated).digest('hex');
        if (!processedHashes.has(hash)) {
          newFilingFound = true;
          break;
        }
      }
      
      if (newFilingFound) {
        const form6KCount = allFilings.filter(f => f.formType === '6-K').length;
        const form8KCount = allFilings.filter(f => f.formType === '8-K').length;
        console.log('');
        log('INFO', `Fetched ${allFilings.length} filings: 6-K: ${form6KCount} / 8-K: ${form8KCount}`);
        console.log('');
      }
      
      const filingsToProcess = allFilings.slice(0, 100);
      for (let i = 0; i < filingsToProcess.length; i++) {
        const filing = filingsToProcess[i];
        let skipReason = ''; // Track why alert is skipped
        try {
          const hash = crypto.createHash('md5').update(filing.title + filing.updated).digest('hex');
          
          if (processedHashes.has(hash)) {
            continue;
          }
          
          processedHashes.set(hash, Date.now());
          
          const filingTime = new Date(filing.updated);
          const filingDate = filingTime.toLocaleString('en-US', { timeZone: 'America/New_York' });
          const text = await Promise.race([
            getFilingText(filing.txtLink),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Filing text fetch timeout')), CONFIG.SEC_FETCH_TIMEOUT * 3))
          ]).catch(() => '');
          
          if (!text) {
            log('WARN', `Failed to fetch filing text for ${filing.txtLink}`);
            console.log('');
        
            continue;
          }
          
          let semanticSignals = parseSemanticSignals(text);
          
          // Extract financial ratio signals - bankruptcy indicators
          const financialRatioData = parseFinancialRatios(text);
          let financialRatioSignals = {};
          if (financialRatioData.signals && financialRatioData.signals.length > 0) {
            financialRatioSignals = {
              signals: financialRatioData.signals,
              severity: financialRatioData.severity,
              isDeterministic: true
            };
          }
          
          let bonusSignals = {};
          
          // Check DTC chill lift (100% mechanical)
          const dtcLift = detectDTCChillLift(text);
          if (dtcLift) bonusSignals['DTC Chill Lift'] = dtcLift;
          
          // Check shell recycling (Form 15 + name change)
          const shellRecycle = detectShellRecycling(text);
          if (shellRecycle) bonusSignals['Shell Recycling'] = shellRecycle;
          
          // Check VStock transfer agent (transfer agent rotation)
          const vstock = detectVStockTransferAgent(text);
          if (vstock) bonusSignals['VStock'] = vstock;
          
          // Check NT 10-K cycle (Chinese ADRs)
          const nt10k = detectNT10KCycle(text, filing.formType);
          if (nt10k) bonusSignals['NT 10K'] = nt10k;
          
          // Check third-party services (proxy solicitors, M&A advisors, transfer agents)
          const thirdPartyServices = detectThirdPartyServices(text);
          if (thirdPartyServices) bonusSignals['Third Party'] = thirdPartyServices;
          
          let source = 'SEC';
          let intent = Object.keys(semanticSignals).join(', ') || null;
          
          // Intent fallback - skip file headers and extract first real sentence
          if (!intent && text) {
            // Remove common file headers and boilerplate
            let cleanText = text
              .replace(/^[^a-z]*?\d{10}-\d{2}-\d{6}[^.]*\./im, '')
              .replace(/^[^a-z]*?EXHIBITS[^.]*\./im, '')
              .replace(/^[^a-z]*?(?:EXHIBIT|INDEX|INFORMATION CONTAINED)[^.]*\./im, '')
              .replace(/^[^a-z]*?(?:form\s*6-?k|period of report|filed|certification)[^.]*\./im, '')
              .replace(/^[^a-z]*?\d{10}-\d{2}-\d{6}\.\w+\s*:\s*\d+\s*\d{10}-\d{2}-\d{6}\.\w+[^.]*\./im, '') // Remove SEC metadata like "0001292814-25-004426.txt : 20251230 0001292814-25-004426.hdr"
              .replace(/^[^a-z]*?SEC\.GOV[^.]*\./im, '')
              .replace(/^[^a-z]*?EDGAR[^.]*\./im, '')
              .replace(/^[^a-z]*?(?:table of contents|company information|item\s+\d+|exhibit|schedule|appendix|annex)[^.]*\./im, '')
              .replace(/^[^a-z]*?(?:signatures|certification|forward-looking|risk factors)[^.]*\./im, '')
              .trim();
            
            // Get first sentence that's longer than 20 chars
            const sentences = cleanText.match(/[^.!?]*[.!?]/);
            if (sentences && sentences[0]) {
              let firstSentence = sentences[0]
                .replace(/^\s+|\s+$/g, '')
                .replace(/\d+\s*of\s*\d+/g, '')
                // Remove common boilerplate words
                .replace(/\b(?:exhibit|item|form|section|schedule|annex|appendix|certification|pursuant|hereby|thereof|thereto|incorporated|organized|registrant|issuer|sec\.?gov|edgar|rule\s+\d+)/gi, '')
                // Remove filing metadata
                .replace(/\b(?:page|pages|continued|see|table|contents|index|filed|effective|period|fiscal|calendar|quarterly|annual)\b/gi, '')
                .replace(/[^\w\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              
              if (firstSentence.length > 20 && firstSentence.length < 200) {
                intent = firstSentence;
              }
            }
          }
          
          logGray('INFO', `${filing.title.slice(0,60)}... - Filed @ ${filingDate} ET`);
          
          const periodOfReport = filing.updated.split('T')[0];
          
          let ticker = 'Unknown';
          let normalizedIncorporated = 'Unknown';
          let normalizedLocated = 'Unknown';
          let companyName = 'N/A';
          let filerName = null;
          
          if (filing.cik) {
            const secData = await getCountryAndTicker(filing.cik);
            ticker = secData.ticker || 'Unknown';
            normalizedIncorporated = secData.incorporated || 'Unknown';
            normalizedLocated = secData.located || 'Unknown';
            companyName = secData.companyName || 'Unknown';
          }
          
          // Try to extract actual filer name from the filing text
          filerName = parseFilerName(text);
          
          // If still no company name from SEC, parse from filing text
          if (companyName === 'Unknown' || companyName === 'N/A') {
            const parsedName = parseApplicantName(text);
            if (parsedName && parsedName !== 'N/A') {
              companyName = parsedName;
            } else {
              companyName = 'N/A';
            }
          }
          
          // Better jurisdiction parsing - Cayman/BVI often show as "Unknown" in normalized data
          // If incorporated is Unknown, check for Cayman/BVI patterns in filing title/text
          if (normalizedIncorporated === 'Unknown' && (text.includes('Cayman') || text.includes('BVI') || text.includes('Virgin Islands'))) {
            normalizedIncorporated = 'Cayman Islands';
          }
          if (normalizedLocated === 'Unknown' && (text.includes('Cayman') || text.includes('BVI') || text.includes('Virgin Islands'))) {
            normalizedLocated = 'Cayman Islands';
          }
          
          if (normalizedIncorporated !== normalizedLocated) {
            log('INFO', `Incorporated: ${normalizedIncorporated}, Located: ${normalizedLocated}`);
          } else {
            log('INFO', `Incorporated: ${normalizedIncorporated}`);
          }
          
          // Fallback: Parse applicant name from filing text if SEC data returned "Unknown"
          if (companyName === 'Unknown') {
            const parsedName = parseApplicantName(text);
            if (parsedName) companyName = parsedName;
          }

          
          if (Object.keys(semanticSignals).length > 0) {
            const allKeywords = [];
            for (const [category, keywords] of Object.entries(semanticSignals)) {
              allKeywords.push(...keywords);
            }
            let newsDisplay = allKeywords.join(', ');
            
            // If "Reverse Split Event" is detected, try to extract the ratio
            if (Object.keys(semanticSignals).includes('Reverse Split Event')) {
              const ratio = extractReverseSplitRatio(text);
              if (ratio) {
                // Replace in both the display and the actual signals array
                newsDisplay = newsDisplay.replace(/1-for-/i, ratio + ' ');
                // Also update the semanticSignals array to replace incomplete '1-for-' with complete ratio
                semanticSignals['Reverse Split Event'] = semanticSignals['Reverse Split Event'].map(kw => 
                  kw === '1-for-' ? ratio : kw
                );
              }
            }
            
            log('INFO', `News: ${newsDisplay}`);
          } else if (intent) {
            log('INFO', `News: Regulatory Update`);
          } else {
            log('INFO', `News: Press Release`);
          }
          
          const foundForms = new Set();
          const foundItems = new Set();
          const titleAndText = (filing.title + ' ' + text).toLowerCase();
          
          for (const form of FORM_TYPES) {
            if (titleAndText.includes(form.toLowerCase())) {
              foundForms.add(form);
            }
          }
          
          const itemMatches = text.match(/\bItem\s+([1-9]\.\d{2})/gi);
          if (itemMatches) {
            itemMatches.forEach(match => {
              const itemCode = match.match(/[1-9]\.\d{2}/)[0];
              foundItems.add(itemCode);
            });
          }
          
          const mainForms = ['6-K', '6-K/A', '8-K', '8-K/A', 'S-1', 'S-3', 'S-4', 'S-8', 'F-1', 'F-3', 'F-4', '424B1', '424B2', '424B3', '424B4', '424B5', '424H8', '20-F', '20-F/A', '13G', '13G/A', '13D', '13D/A', 'Form D', 'EX-99.1', 'EX-99.2', 'EX-99.3', 'EX-10.1', 'EX-10.2', 'EX-10.3', 'EX-3.1', 'EX-3.2', 'EX-4.1', 'EX-4.2', 'EX-1.1'];
          const mainItems = ['1.01', '1.02', '1.03', '1.04', '1.05', '1.06', '2.01', '2.02', '2.03', '2.04', '2.05', '2.06', '3.01', '3.02', '3.03', '4.01', '4.02', '5.01', '5.02', '5.03', '5.04', '5.05', '5.06', '5.07', '5.08', '5.09', '5.10', '5.11', '5.12', '5.13', '5.14', '5.15', '6.01', '6.02', '7.01', '8.01', '9.01', '9.02', '10.01', '10.02', '10.03', '10.04'];
          const otherForms = Array.from(foundForms).filter(f => mainForms.includes(f));
          const otherItems = Array.from(foundItems).filter(i => mainItems.includes(i));
          const formsDisplay = otherForms.length > 0 ? otherForms.join(', ') : '';
          const itemsDisplay = otherItems.length > 0 ? otherItems.sort((a, b) => parseFloat(a) - parseFloat(b)).map(item => `Item ${item}`).join(', ') : '';
          
          const bearishCategories = ['Bankruptcy Filing', 'Credit Default', 'Material Lawsuit', 'Going Dark', 'Asset Disposition', 'Convertible Debt', 'Auditor Change', 'Accounting Restatement', 'Regulatory Breach', 'Nasdaq Delisting', 'Bid Price Delisting', 'Reverse Split Event', 'Executive Departure'];
          const signalKeys = Object.keys(semanticSignals);
          
          let formLogMessage = '';
          if (formsDisplay && formsDisplay !== '') {
            formLogMessage = formsDisplay;
          }
          if (itemsDisplay && itemsDisplay !== '') {
            if (formLogMessage) formLogMessage += ', ' + itemsDisplay;
            else formLogMessage = itemsDisplay;
          }
          if (!formLogMessage) formLogMessage = 'None';
          log('INFO', `Forms: ${formLogMessage}`);
          
          if (filerName) {
            const formerNameHidden = detectFormerNameHidden(text);
            const registrantLog = filerName + (formerNameHidden ? ' (N/A)' : '');
            log('INFO', `Author: ${registrantLog}`);
          } else {
          }
          
          // Fetch and log industry/sector immediately after author
          let sectorDisplay = 'N/A';
          try {
            const sectorData = await Promise.race([
              getSectorFromFinnhub(ticker),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
            ]);
            if (sectorData) {
              sectorDisplay = sectorData;
            }
          } catch (e) {
            sectorDisplay = 'N/A';
          }
          log('INFO', `Sector: ${sectorDisplay}`);
          
          let price = 'N/A', volume = 0, marketCap = 'N/A', averageVolume = 0, float = 'N/A', sharesOutstanding = 'N/A';
          let quoteData = null;
          
          if (ticker !== 'UNKNOWN' && isValidTicker(ticker)) {
            try {
              const finnhubKey = process.env.FINNHUB_API_KEY;
              
              // FAST PATH: Use cached performance data first (non-blocking)
              try {
                if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
                  const perfContent = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
                  if (perfContent) {
                    const perfData = JSON.parse(perfContent);
                    if (perfData[ticker]) {
                      price = perfData[ticker].current || 'N/A';
                      averageVolume = perfData[ticker].avgVol || 0;
                    }
                  }
                }
              } catch (e) {}
              
              // Try Yahoo FIRST with generous timeout
              try {
                quoteData = await Promise.race([
                  yahooFinance.quote(ticker, {
                    fields: ['regularMarketPrice', 'regularMarketVolume', 'marketCap', 'sharesOutstanding', 'averageDailyVolume3Month']
                  }),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
                ]).catch(() => null);
              } catch (e) {}
              
              // If Yahoo didn't work, try Finnhub 
              if (!quoteData && finnhubKey) {
                try {
                  const fhRes = await Promise.race([
                    fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}`, 6000),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6500))
                  ]);
                  if (fhRes.ok) {
                    const fhQuote = await fhRes.json();
                    if (fhQuote.c && fhQuote.c > 0) {
                      quoteData = {
                        regularMarketPrice: fhQuote.c,
                        regularMarketVolume: fhQuote.v || 0,
                        marketCap: 'N/A',
                        sharesOutstanding: 'N/A',
                        averageDailyVolume3Month: 0
                      };
                    }
                  }
                } catch (e) {}
              }
              
              if (quoteData) {
                price = quoteData.regularMarketPrice || price;
                volume = quoteData.regularMarketVolume || 0;
                marketCap = quoteData.marketCap || 'N/A';
                sharesOutstanding = quoteData.sharesOutstanding || 'N/A';
                averageVolume = quoteData.averageDailyVolume3Month || averageVolume;
              }
              
              // Fetch float data with generous timeout (max 5s)
              if (float === 'N/A') {
                try {
                  // FIRST: Try extracting from SEC filing text
                  const floatFromFiling = extractFloatFromFiling(text, sharesOutstanding);
                  if (floatFromFiling && floatFromFiling > 0) {
                    float = floatFromFiling;
                  } else {
                    // FALLBACK: Try API calls
                    float = await Promise.race([
                      getFloatData(ticker),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                    ]);
                  }
                } catch (e) {
                  float = 'N/A';
                }
              }
              
              // Fetch shares outstanding if missing (max 5s)
              if (sharesOutstanding === 'N/A') {
                try {
                  sharesOutstanding = await Promise.race([
                    getSharesOutstanding(ticker),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
                  ]);
                } catch (e) {}
              }
            } catch (err) {}
          }
          
          const priceDisplay = price !== 'N/A' ? `$${price.toFixed(2)}` : 'N/A';
          const volDisplay = volume && volume > 0 ? volume.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A';
          const avgDisplay = averageVolume && averageVolume > 0 ? averageVolume.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A';
          const mcDisplay = marketCap !== 'N/A' && marketCap > 0 ? '$' + Math.round(marketCap).toLocaleString('en-US') : 'N/A';
          const floatDisplay = float !== 'N/A' ? float.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'N/A';
          
          // Get FTD data EARLY - before any skips
          const ftdData = getFTDData(ticker);
          let ftdPercent = null;
          if (ftdData && float !== 'N/A') {
            const floatNum = parseFloat(float);
            if (floatNum > 0) {
              ftdPercent = ((ftdData / floatNum) * 100).toFixed(2);
            }
          }
          
          let soRatio = 'N/A';
          if (sharesOutstanding !== 'N/A' && float !== 'N/A' && sharesOutstanding > 0 && !isNaN(float) && !isNaN(sharesOutstanding)) {
            const ratio = (float / sharesOutstanding) * 100;
            soRatio = ratio < 100 ? ratio.toFixed(2) + '%' : ratio.toFixed(1) + '%';
          }
          
          // Check if stock is on CTB watchlist early - will skip non-fundamental filters
          const isOnCTBWatchlist = CONFIG.CTB_WATCHLIST.includes(ticker.toUpperCase());
          
          let shortOpportunity = null;
          let longOpportunity = null;
          
          // CTB stocks bypass direction/SHORT-LONG determination - only fundamentals filter
          if (!isOnCTBWatchlist) {
            // Determine if this is a SHORT or LONG opportunity based on signals (non-CTB only)
            const sigKeys = Object.keys(semanticSignals || {});
            
            // Bearish signals that force SHORT regardless
            const bearishCats = ['Bankruptcy Filing', 'Credit Default', 'Material Lawsuit', 'Going Dark', 'Convertible Debt', 'Executive Departure', 'Auditor Change', 'Accounting Restatement', 'Regulatory Breach', 'Nasdaq Delisting', 'Bid Price Delisting'];
            const bearishCount = sigKeys.filter(cat => bearishCats.includes(cat)).length;
            const bullishCats = ['Merger/Acquisition', 'FDA Approved', 'FDA Breakthrough', 'FDA Filing', 'Clinical Success', 'Clinical Milestone', 'DTC Eligible Restored', 'Government Contract', 'Partnership', 'Licensing Deal', 'Stock Buyback', 'Capital Raise', 'Underwritten Offering'];
            const bullishCount = sigKeys.filter(cat => bullishCats.includes(cat)).length;
            const hasPartnership = sigKeys.includes('Partnership');
            
            // Determine SHORT or LONG - bullish signals that drive price up should override single bearish signals
            if (bearishCount >= 2) {
              shortOpportunity = true;
            } else if (bearishCount > 0 && bullishCount >= 2) {
              // Strong bullish signals (2+) override single bearish signals - use bullish
              longOpportunity = true;
            } else if (bearishCount > 0 && bullishCount > 0) {
              // Single bearish + single bullish: default to SHORT to avoid false LONG calls
              shortOpportunity = true;
            } else if (bearishCount > 0) {
              shortOpportunity = true;
            } else if (bullishCount >= 2) {
              // Need at least 2 bullish signals for LONG (not just 1)
              longOpportunity = true;
            } else if (hasPartnership && bullishCount === 0) {
              // Partnership alone is neutral - don't mark as long or short
              shortOpportunity = null;
              longOpportunity = null;
            }
            // If no signals, leave both null for "N/A"
            
            // Log the intent prefix based on actual SHORT/LONG determination
            if (signalKeys.length > 0) {
              const intentPrefix = shortOpportunity ? 'Short' : (longOpportunity ? 'Long' : 'Neutral');
              log('INFO', `${intentPrefix}: ${signalKeys.join(', ')}`);
            }
          }
          
          const now = new Date();
          const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const etHour = etTime.getHours();
          const etMin = etTime.getMinutes();
          const etTotalMin = etHour * 60 + etMin;
          const startMin = 3.5 * 60; // 3:30am = 210 minutes
          const endMin = 18 * 60; // 6:00pm = 1080 minutes
          
          // Convert to numeric values for calculations
          const numFloat = (() => { const v = typeof float === 'number' ? float : (typeof float === 'string' && float !== 'N/A' ? parseFloat(float) : NaN); return isNaN(v) ? null : v; })();
          const numAvgVol = (() => { const v = typeof averageVolume === 'number' ? averageVolume : (typeof averageVolume === 'string' && averageVolume !== 'N/A' ? parseFloat(averageVolume) : NaN); return isNaN(v) ? 1 : v; })();
          
          // Calculate F/AV early for logging (before it's used at line 8012)
          const favValue = numAvgVol > 0 ? (numFloat / numAvgVol) : 0;
          const fav = (favValue && favValue > 0) ? favValue.toFixed(2) : 'N/A';
          
          // Get signal categories early for scoring function
          const signalCategories = Object.keys(semanticSignals || {});
          
          const deterministic = detectDeterministicPatterns(semanticSignals);
          const deterministicPhrase = deterministic.mechanism ? `[${deterministic.mechanism}]` : '';
          
          // Add deterministic signals to categories for scoring boost
          const enhancedSignalCategories = signalCategories;
          
          // Layer 1: Extract Item Code for context (Item 8.01, 6.01, etc.)
          const itemCode = extractItemCode(text);
          
          // Layer 2: Extract insider buying amounts
          const insiderBuyingData = extractInsiderBuyingAmount(text);
          
          // Layer 3: Detect financing type (Bought Deal, Registered Direct, ATM, etc.)
          const financingType = detectFinancingType(text);
          
          // Layer 4: Detect M&A close + rebrand as structural catalyst
          const maClosureData = detectMACloseRebrand(text);
          
          // Apply insider buying confidence multiplier
          let insiderConfidenceMultiplier = 1.0;
          if (insiderBuyingData && insiderBuyingData.insiderShares > 0) {
            if (insiderBuyingData.participants.includes('ceo') && insiderBuyingData.participants.includes('chairman')) {
              insiderConfidenceMultiplier = 1.3; // CEO + Chairman co-investing = death spiral reversal
            } else if (insiderBuyingData.participants.includes('ceo')) {
              insiderConfidenceMultiplier = 1.25; // CEO buying alone = strong validation
            } else if (insiderBuyingData.participants.length > 1) {
              insiderConfidenceMultiplier = 1.20; // Multiple insiders
            } else {
              insiderConfidenceMultiplier = 1.10; // Generic insider buying
            }
          }
                    
          // FTD display with percentage
          let ftdDisplay = 'false';
          if (ftdData) {
            ftdDisplay = ftdData.toLocaleString('en-US');
            if (ftdPercent) {
              ftdDisplay += ` (${ftdPercent}%)`;
            }
          }
          
          const directionLabel = shortOpportunity ? 'SHORT' : (longOpportunity ? 'LONG' : 'N/A');
          const favLog = fav !== 'N/A' ? fav : 'N/A';
          
          // === LOG STOCK METRICS FOR ALL FILINGS (before validation checks) ===
          log('INFO', `Stock: $${ticker}, Price: ${priceDisplay}, Vol/Avg: ${volDisplay}/${avgDisplay}, MC: ${mcDisplay}, Float: ${floatDisplay}, S/O: ${soRatio}, F/AV: ${favLog}, FTD: ${ftdDisplay}, ${directionLabel}`);
                    
          // Check for FDA Approvals and Chinese/Cayman reverse splits
          const hasFDAApproval = signalCategories.some(cat => ['FDA Approved', 'FDA Breakthrough', 'FDA Filing'].includes(cat));
          const isChinaOrCaymanReverseSplit = (normalizedIncorporated === 'China' || normalizedLocated === 'China' || normalizedIncorporated === 'Cayman Islands' || normalizedLocated === 'Cayman Islands') && signalCategories.includes('Reverse Split Event');
          
          // CTB stocks skip country and jurisdiction filters
          if (!isOnCTBWatchlist && normalizedLocated === 'Unknown') {
            skipReason = 'No valid country';
            const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
            const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
            log('INFO', `Links: ${secLink} ${tvLink}`);
            log('SKIP', `$${ticker}, ${skipReason}`);
            console.log('');
            // Save to CSV with skip reason
            try {
              const csvData = {
                ticker,
                price,
                short: shortOpportunity ? true : false,
                marketCap: marketCap,
                float: float,
                sharesOutstanding: sharesOutstanding,
                soRatio: soRatio,
                ftd: ftdData || false,
                ftdPercent: ftdPercent || null,
                volume: volume,
                averageVolume: averageVolume,
                incorporated: normalizedIncorporated,
                located: normalizedLocated,
                intent: semanticSignals && Object.keys(semanticSignals).length > 0 ? Object.keys(semanticSignals)[0] : null,
                filingDate: filing.updated,
                filingType: formLogMessage,
                cik: filing.cik,
                sector: sectorDisplay,
                fav: fav,
                companyName: filerName || companyName || 'N/A',
                financialRatioSignals: financialRatioSignals,
                skipReason: skipReason,
              };
              saveToCSV(csvData);
            } catch (csvErr) {
              log('ERROR', `CSV error: ${csvErr.message}`);
            }
            continue;
          }
          
          // Calculate S/O ratio for use in multiple filters
          let soRatioValue = null;
          if (sharesOutstanding !== 'N/A' && float !== 'N/A' && sharesOutstanding > 0) {
            const so = parseFloat(sharesOutstanding);
            const fl = parseFloat(float);
            if (!isNaN(fl) && !isNaN(so)) {
              soRatioValue = (fl / so) * 100;
            }
          }
          
          const neutralCategories = ['Partnership', 'Licensing Deal', 'Government Contract', 'Stock Buyback'];
          const neutralSignals = signalCategories.filter(cat => neutralCategories.includes(cat));
          const nonNeutralSignals = signalCategories.filter(cat => !neutralCategories.includes(cat));
          
          // Check if country is whitelisted - SKIP for CTB stocks
          let countryWhitelisted = true;
          if (!isOnCTBWatchlist) {
            const incorporatedMatch = CONFIG.ALLOWED_COUNTRIES.some(country => normalizedIncorporated.toLowerCase().includes(country));
            const locatedMatch = CONFIG.ALLOWED_COUNTRIES.some(country => normalizedLocated.toLowerCase().includes(country));
            const isCaymanOrBVI = normalizedIncorporated.toLowerCase().includes('cayman') || normalizedLocated.toLowerCase().includes('cayman') || 
                                  normalizedIncorporated.toLowerCase().includes('virgin') || normalizedLocated.toLowerCase().includes('virgin');
            const hasSPSignal = signalCategories.includes('Reverse Split Event') || signalCategories.includes('Nasdaq Delisting') || signalCategories.includes('Bid Price Delisting');
            
            if (filing.formType === '6-K' || filing.formType === '6-K/A') {
              // 6-K filings: Only allow whitelisted countries
              countryWhitelisted = incorporatedMatch || locatedMatch;
            } else {
              // 8-K: Only allow whitelisted countries
              countryWhitelisted = incorporatedMatch || locatedMatch;
            }
          }
          
          if (!countryWhitelisted) {
            skipReason = `Location not whitelisted (${normalizedIncorporated}, ${normalizedLocated})`;
            const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
            const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
            log('INFO', `Links: ${secLink} ${tvLink}`);
            log('SKIP', `$${ticker}, ${skipReason}`);
            console.log('');
            continue;
          }
          
          // Check float limits based on filing type
          if (float !== 'N/A' && typeof float === 'number') {
            const maxFloat = (filing.formType === '6-K' || filing.formType === '6-K/A') ? CONFIG.MAX_FLOAT_6K : CONFIG.MAX_FLOAT_8K;
            if (float > maxFloat) {
              skipReason = `Float too large: ${(float / 1000000).toFixed(1)}M exceeds ${(maxFloat / 1000000).toFixed(0)}M limit (${filing.formType})`;
              const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
              const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
              log('INFO', `Links: ${secLink} ${tvLink}`);
              log('SKIP', `$${ticker}, ${skipReason}`);
              console.log('');
              continue;
            }
          }
          
          const volumeValue = volume !== 'N/A' ? parseFloat(volume) : null;

          // Determine volume threshold based on signal strength (bot-reactive detection)
          // HIGH-CONVICTION SIGNALS (bypass volume entirely):
          // - Insider Buying + any bullish (FDA, Merger, Clinical, Contract, Buyback)
          // - Merger/Acquisition (bots trade immediately)
          // - FDA Approved + Clinical Success combo
          // - Insider Block Buy (large position)
          const hasInsiderBuying = signalCategories.includes('Insider Buying');
          const hasInsiderBlockBuy = signalCategories.includes('Insider Buying');
          const hasMerger = signalCategories.includes('Merger/Acquisition');
          const hasFDA = signalCategories.includes('FDA Approved') || signalCategories.includes('FDA Breakthrough');
          const hasClinical = signalCategories.includes('Clinical Success') || signalCategories.includes('Clinical Milestone');
          const hasPartnership = signalCategories.includes('Partnership');
          const hasStockBuyback = signalCategories.includes('Stock Buyback');
          
          // Bot-reactive high-conviction combos (skip volume gate)
          const isHighConviction = 
            hasInsiderBlockBuy ||                                           // Large position = immediate bot action
            hasMerger ||                                                    // M&A = bots trade instantly
            (hasFDA && hasClinical) ||                                      // FDA + clinical = biotech catalyst
            (hasInsiderBlockBuy && (hasMerger || hasFDA || hasClinical || hasPartnership || hasStockBuyback)); // Insider accumulation + catalyst
          
          const volumeCheckLater = volumeValue;
          const avgVolumeValue = averageVolume !== 'N/A' ? parseFloat(averageVolume) : null;
          const volumeIs3xAverage = volumeCheckLater !== null && avgVolumeValue !== null && volumeCheckLater >= (avgVolumeValue * 3);
          
          // Dynamic volume threshold based on signal strength
          let minVolumeThreshold;
          if (isHighConviction || volumeIs3xAverage) {
            minVolumeThreshold = 0; // Bypass volume gate for high-conviction signals
          } else if (hasFDAApproval || hasClinical) {
            minVolumeThreshold = 10000; // Biotech needs some volume confirmation
          } else if (signalCategories.length >= 2) {
            minVolumeThreshold = 5000; // Combo signals need moderate volume
          } else {
            minVolumeThreshold = CONFIG.MIN_ALERT_VOLUME; // Single weak signal needs more volume
          }
          
          // Check volume (skip for high-conviction or 3x average)
          if (minVolumeThreshold > 0 && volumeCheckLater !== null && volumeCheckLater < minVolumeThreshold) {
            skipReason = `Volume ${volumeCheckLater.toLocaleString('en-US')} below ${(minVolumeThreshold / 1000).toFixed(0)}k minimum`;
            const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
            const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
            log('INFO', `Links: ${secLink} ${tvLink}`);
            log('SKIP', `$${ticker}, ${skipReason}`);
            console.log('');
            // Save to CSV with skip reason
            try {
              const csvData = {
                ticker,
                price,
                short: shortOpportunity ? true : false,
                marketCap: marketCap,
                float: float,
                sharesOutstanding: sharesOutstanding,
                soRatio: soRatio,
                ftd: ftdData || false,
                ftdPercent: ftdPercent || null,
                volume: volume,
                averageVolume: averageVolume,
                incorporated: normalizedIncorporated,
                located: normalizedLocated,
                intent: semanticSignals && Object.keys(semanticSignals).length > 0 ? Object.keys(semanticSignals)[0] : null,
                filingDate: filing.updated,
                filingType: formLogMessage,
                cik: filing.cik,
                sector: sectorDisplay,
                fav: fav,
                companyName: filerName || companyName || 'N/A',
                financialRatioSignals: financialRatioSignals,
                skipReason: skipReason,
              };
              saveToCSV(csvData);
            } catch (csvErr) {
              log('ERROR', `CSV error: ${csvErr.message}`);
            }
            continue;
          }
          
          let validSignals = false;
          
          // Calculate core categories for all stocks (needed for logging and later checks)
          const coreCategories = ['FDA Approved', 'FDA Breakthrough', 'Clinical Success', 'Clinical Milestone', 'Merger/Acquisition', 'Credit Default', 'Going Dark', 'Bankruptcy Filing', 'Auditor Change', 'Asset Disposition', 'Reverse Split Event', 'Commercial Inflection'];
          const hasCoreCategories = signalCategories.filter(cat => coreCategories.includes(cat)).length;
          const isDeterministic = hasCoreCategories >= 2;
          
          // CTB stocks bypass signal validation - only fundamental filters apply
          if (isOnCTBWatchlist) {
            validSignals = true; // CTB stocks skip all signal requirements
          } else {
            // For non-CTB: Require minimum signal quality
            // Need at least 2 core categories OR deterministic pattern to qualify
            if (hasCoreCategories >= 2 || isDeterministic) {
              validSignals = true;
            }
          }
          
          if (!validSignals) {
            skipReason = `Not enough signal weight`;
            const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
            const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
            log('INFO', `Links: ${secLink} ${tvLink}`);
            log('SKIP', `$${ticker}, ${skipReason}`);
            console.log('');
            // Save to CSV with skip reason
            try {
              const csvData = {
                ticker,
                price,
                short: shortOpportunity ? true : false,
                marketCap: marketCap,
                float: float,
                sharesOutstanding: sharesOutstanding,
                soRatio: soRatio,
                ftd: ftdData || false,
                ftdPercent: ftdPercent || null,
                volume: volume,
                averageVolume: averageVolume,
                incorporated: normalizedIncorporated,
                located: normalizedLocated,
                intent: semanticSignals && Object.keys(semanticSignals).length > 0 ? Object.keys(semanticSignals)[0] : null,
                filingDate: filing.updated,
                filingType: formLogMessage,
                cik: filing.cik,
                sector: sectorDisplay,
                fav: fav,
                companyName: filerName || companyName || 'N/A',
                financialRatioSignals: financialRatioSignals,
                skipReason: skipReason,
              };
              saveToCSV(csvData);
            } catch (csvErr) {
              log('ERROR', `CSV error: ${csvErr.message}`);
            }
            continue;
          }

          // F/AV filtering: skip stocks exceeding max ratio (90x)
          const favNum = parseFloat(fav) || 0;
          if (favNum > CONFIG.MAX_FAV_RATIO && favNum !== 0) {
            alertData.skipReason = `F/AV ${favNum}x exceeds max threshold of ${CONFIG.MAX_FAV_RATIO}x`;
            saveToCSV(alertData);
            const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
            const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
            log('INFO', `Links: ${secLink} ${tvLink}`);
            log('SKIP', `$${ticker}, F/AV ${favNum}x exceeds ${CONFIG.MAX_FAV_RATIO}x limit`);
            console.log('');
            continue;
          }
          
          // Check if custodian control (ADR structure) applies - verified via filing text or structure
          const custodianControl = (normalizedIncorporated && normalizedLocated && normalizedIncorporated.toLowerCase() !== normalizedLocated.toLowerCase());
          const isCustodianVerified = custodianControl && normalizedIncorporated && normalizedLocated && normalizedIncorporated.toLowerCase() !== normalizedLocated.toLowerCase();
          let custodianName = null;
          if (isCustodianVerified) {
            custodianName = `${normalizedLocated} (via ${normalizedIncorporated})`;
          }
          
          const filingTimeMultiplier = getFilingTimeMultiplier(filing.updated);
          
          // Filing time bonus: stronger when filed near open/close (9:30am & 3:30pm ET)
          const filingTimeBonus = filingTimeMultiplier > 1.0 ? parseFloat(filingTimeMultiplier.toFixed(2)) : null;
          
          // Check if filing date is Tuesday (day of week = 2)
          const filingDateObj = new Date(filing.updated);
          const dayOfWeek = filingDateObj.getDay(); // 0 = Sunday, 1 = Monday, 2 = Tuesday, etc.
          const hasTuesdayBonus = dayOfWeek === 2;
          
          // Detect reverse split ratio and reason
          let reverseSplitRatio = null;
          let reverseSplitReason = null;
          if (Object.keys(semanticSignals).includes('Reverse Split Event')) {
            const ratio = extractReverseSplitRatio(text);
            if (ratio) {
              // Keep the full "1-for-X" format, don't extract just the number
              reverseSplitRatio = ratio;
              
              // Detect reason for split
              const lowerText = text.toLowerCase();
              if (lowerText.includes('nasdaq') && (lowerText.includes('bid') || lowerText.includes('price') || lowerText.includes('minimum'))) {
                reverseSplitReason = 'Nasdaq minimum bid price requirement';
              } else if (lowerText.includes('listing') && lowerText.includes('standard')) {
                reverseSplitReason = 'Listing standard compliance';
              } else if (lowerText.includes('consolidat')) {
                reverseSplitReason = 'Share consolidation';
              } else if (lowerText.includes('stock split')) {
                reverseSplitReason = 'Stock split';
              } else {
                reverseSplitReason = 'Reverse stock split';
              }
            }
          }
          
          const alertData = {
            ticker: ticker || filing.cik || 'Unknown',
            title: filing.title ? filing.title.replace(/\s*\(\d{10}\)\s*$/, '').trim() : 'Unknown Company',
            companyName: companyName !== 'Unknown' ? companyName : null,
            filerName: filerName || null,
            sector: await getSectorFromFinnhub(ticker),
            price: price,
            fav: fav,
            hasTuesdayBonus: hasTuesdayBonus,
            custodianControl: custodianControl,
            custodianVerified: isCustodianVerified,
            custodianName: custodianName,
            filingTimeMultiplier: filingTimeMultiplier,
            filingTimeBonus: filingTimeBonus,
            volume: volume,
            averageVolume: averageVolume,
            float: float,
            sharesOutstanding: sharesOutstanding,
            soRatio: soRatio,
            marketCap: marketCap,
            isShort: shortOpportunity ? true : false,
            ftd: ftdData || false,
            ftdPercent: ftdPercent || null,
            intent: intent || 'Regulatory Filing',
            incorporated: normalizedIncorporated,
            located: normalizedLocated,
            filingDate: periodOfReport,
            signals: semanticSignals,
            bonusSignals: bonusSignals,
            financialRatioSignals: financialRatioSignals,
            reverseSplitRatio: reverseSplitRatio,
            reverseSplitReason: reverseSplitReason,
            formType: Array.from(foundForms),
            filingType: formLogMessage,
            cik: filing.cik,
            skipReason: skipReason,
            alertType: null,  // Set to 'Toxic Structure', 'High Velocity', or 'Composite' if alerted
            deterministicPattern: deterministic.pattern,
            deterministicMechanism: deterministic.mechanism,
            deterministicPhrase: deterministicPhrase
          };
          
          // Only save alert if we got price, float, and S/O data
          if (price !== 'N/A' && float !== 'N/A' && soRatio !== 'N/A') {
            // Check for duplicate alert - don't re-alert the same stock within session
            let isDuplicate = false;
            
            // First check: already alerted in this cycle
            if (alertedTickers.has(ticker)) {
              isDuplicate = true;
            } else {
              // Second check: in saved alerts file (from previous cycles)
              try {
                if (fs.existsSync(CONFIG.ALERTS_FILE)) {
                  const existingAlerts = JSON.parse(fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8'));
                  if (Array.isArray(existingAlerts) && existingAlerts.length > 0) {
                    // Check if this ticker was already alerted in the last 100 alerts (more comprehensive check)
                    const recentAlerts = existingAlerts.slice(-100);
                    isDuplicate = recentAlerts.some(alert => alert.ticker === ticker);
                  }
                }
              } catch (e) {
                // If can't read alerts file, proceed without duplicate check
              }
            }
            
            // Final safety: Check if ticker is in current alertedTickers again (in case of rapid processing)
            if (!isDuplicate && alertedTickers.has(ticker)) {
              isDuplicate = true;
            }
            
            if (isDuplicate) {
              alertData.skipReason = 'Duplicate Alert';
              const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
              const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
              log('INFO', `Links: ${secLink} ${tvLink}`);
              log('SKIP', `$${ticker} duplicate alert, already alerted in current session or recent alerts file`);
              console.log('');
              // Don't save duplicate alerts
            } else {
              // Check if stock is on CTB watchlist (high CTB + low availability setup)
              const isOnCTBWatchlist = CONFIG.CTB_WATCHLIST.includes(ticker.toUpperCase());
              
              // This filters down from 25+ alerts to ~3-5 high-confidence alerts
              const isDeterministic = deterministic.pattern !== null && deterministic.pattern !== undefined;
              
              // CTB stocks override deterministic check - ANY filing triggers alert with CTB tag
              if (isOnCTBWatchlist) {
                // Mark as alerted BEFORE saving (prevent concurrent duplicate processing)
                alertedTickers.add(ticker);
                alertData.alertType = 'CTB Squeeze'; // Tag as high-CTB setup
                alertData.skipReason = ''; // Clear skip reason - this is an alert
                // OVERRIDE normal filters for CTB watchlist stocks
                saveAlert(alertData);
              } else if (nonNeutralSignals.length < 2 && !isDeterministic) {
                // Non-CTB stocks with 0-1 signals AND no deterministic pattern = skip
                // BUT 2+ signal combinations bypass this gate (combo trading signal)
                alertData.skipReason = 'Insufficient Signal Combination (need 2+)';
                // Save to CSV for later analysis only
                saveToCSV(alertData);
                const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
                const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
                log('INFO', `Links: ${secLink} ${tvLink}`);
                log('SKIP', `$${ticker}, weak signal combo`);
                console.log('');
              } else {
                // Check additional quality filters

                  if (alertData.intent === 'neutral') {
                  alertData.skipReason = 'Neutral Signal';
                  saveToCSV(alertData);
                } else if (Object.keys(semanticSignals).length < 1) {
                  alertData.skipReason = 'No Signals';
                  saveToCSV(alertData);
                } else if (volume !== 'N/A' && parseFloat(volume) < 5000) {
                  alertData.skipReason = 'Minimal Volume';
                  saveToCSV(alertData);
                } else {
                  // All quality checks passed - SEND THE ALERT
                  // Mark as alerted BEFORE saving (prevent concurrent duplicate processing)
                  alertedTickers.add(ticker);
                  alertData.alertType = null;
                  saveAlert(alertData);
                }
              }
            }
          } else {
            // Not enough data to process
            if (price === 'N/A') {
              skipReason = 'No Price Data';
            } else if (float === 'N/A') {
              skipReason = 'No Float Data';
            } else if (soRatio === 'N/A') {
              skipReason = 'No S/O Data';
            } else {
              skipReason = 'Incomplete Data';
            }
            
            const secLink = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${filing.cik}&type=6-K&dateb=&owner=exclude&count=100`;
            const tvLink = `https://www.tradingview.com/chart/?symbol=${getExchangePrefix(ticker)}:${ticker}`;
            log('INFO', `Links: ${secLink} ${tvLink}`);
            log('INFO', `Quote: Incomplete data for ${ticker} (price: ${price}, float: ${float}, s/o: ${soRatio})`);
            log('SKIP', `$${ticker}, ${skipReason}`);
            console.log('');
            // Save to CSV with skip reason
            try {
              const csvData = {
                ticker,
                price,
                short: shortOpportunity ? true : false,
                marketCap: marketCap,
                float: float,
                sharesOutstanding: sharesOutstanding,
                soRatio: soRatio,
                ftd: ftdData || false,
                ftdPercent: ftdPercent || null,
                volume: volume,
                averageVolume: averageVolume,
                incorporated: normalizedIncorporated,
                located: normalizedLocated,
                intent: semanticSignals && Object.keys(semanticSignals).length > 0 ? Object.keys(semanticSignals)[0] : null,
                filingDate: filing.updated,
                filingType: formLogMessage,
                cik: filing.cik,
                sector: sectorDisplay,
                fav: fav,
                companyName: filerName || companyName || 'N/A',
                financialRatioSignals: financialRatioSignals,
                skipReason: skipReason,
              };
              saveToCSV(csvData);
            } catch (csvErr) {
              log('ERROR', `CSV error: ${csvErr.message}`);
            }
            // Don't save alert if we don't have complete data
          }
        } catch (err) {
          log('WARN', `Filing processing error: ${err.message}`);
        }
      }
      
      if (processedHashes.size > 100) {
        const arr = Array.from(processedHashes.entries())
          .sort((a, b) => b[1] - a[1]) // Sort by time desc
          .slice(0, 80);
        
        processedHashes.clear();
        arr.forEach(([hash, time]) => processedHashes.set(hash, time));
      }
      
      const now = new Date();
      const etTime = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
      const etHour = parseInt(etTime.split(', ')[1].split(':')[0]);
      const isPeak = etHour >= 7 && etHour <= 10;
      const isWeekend = now.getDay() === 0 || now.getDay() === 6;
      const isTradingHours = etHour >= 3 && etHour < 18 && !isWeekend;
      
      let refreshInterval;
      if (isWeekend) {
        refreshInterval = CONFIG.REFRESH_WEEKEND;  // 15m on weekends
      } else if (!isTradingHours) {
        refreshInterval = CONFIG.REFRESH_NIGHT;    // 10m outside trading hours
      } else if (isPeak) {
        refreshInterval = CONFIG.REFRESH_PEAK;     // 30s during peak (7am-10am)
      } else {
        refreshInterval = CONFIG.REFRESH_NORMAL;   // 2m during trading hours
      }
      
      await wait(refreshInterval);
    } catch (err) {
      log('ERROR', `Filing loop error: ${err.message}`);
      await wait(60000);
    }
  }

})();

// Background price updater - fetch live prices for all alert tickers and update quote.json
const updateAllTickerPrices = async () => {
  try {
    // Load current alerts
    if (!fs.existsSync(CONFIG.ALERTS_FILE)) return;
    
    const alertsContent = fs.readFileSync(CONFIG.ALERTS_FILE, 'utf8').trim();
    if (!alertsContent) return;
    
    let alerts = [];
    try {
      alerts = JSON.parse(alertsContent);
      if (!Array.isArray(alerts)) alerts = [];
    } catch (e) {
      log('ERROR', `Failed to parse alerts: ${e.message}`);
      return;
    }
    
    // Load current performance data
    let performanceData = {};
    if (fs.existsSync(CONFIG.PERFORMANCE_FILE)) {
      const content = fs.readFileSync(CONFIG.PERFORMANCE_FILE, 'utf8').trim();
      if (content) {
        try {
          performanceData = JSON.parse(content);
          if (!performanceData || typeof performanceData !== 'object') {
            performanceData = {};
          }
        } catch (e) {
          log('WARN', `Failed to parse performance data: ${e.message}`);
          performanceData = {};
        }
      }
    }
    
    // Get unique tickers from alerts and load stocks.json to map alert prices
    const tickers = [...new Set(alerts.map(a => a.ticker).filter(t => t))];
    
    if (tickers.length === 0) return;
    
    // Load stocks.json to get the REAL alert prices
    let stocksMap = {};
    if (fs.existsSync(CONFIG.STOCKS_FILE)) {
      try {
        const stocksContent = fs.readFileSync(CONFIG.STOCKS_FILE, 'utf8').trim();
        if (stocksContent) {
          const stocks = JSON.parse(stocksContent);
          if (Array.isArray(stocks)) {
            // Build map of ticker -> price (use first/most recent entry per ticker)
            for (const stock of stocks) {
              if (stock.ticker && stock.price && !stocksMap[stock.ticker]) {
                stocksMap[stock.ticker] = stock.price;
              }
            }
          }
        }
      } catch (e) {
        log('WARN', `Failed to load stocks for price mapping: ${e.message}`);
      }
    }
    
    let updated = 0;
    // Fetch prices for all tickers
    for (const ticker of tickers) {
      try {
        let quote = null;
        
        // Try Yahoo Finance first
        try {
          await rateLimit.wait();
          quote = await yahooFinance.quote(ticker, {
            fields: ['regularMarketPrice', 'regularMarketDayHigh', 'regularMarketDayLow', 'regularMarketVolume', 'averageDailyVolume3Month', 'marketCap']
          });
        } catch (err) {
          // Yahoo failed, try local quote.json
          try {
            if (fs.existsSync('./logs/quote.json')) {
              const quoteData = JSON.parse(fs.readFileSync('./logs/quote.json', 'utf8'));
              if (quoteData[ticker] && quoteData[ticker].currentPrice) {
                quote = {
                  symbol: ticker,
                  regularMarketPrice: quoteData[ticker].currentPrice,
                  regularMarketVolume: quoteData[ticker].volume || 0,
                  averageDailyVolume3Month: quoteData[ticker].averageVolume || 0,
                  marketCap: quoteData[ticker].marketCap || 'N/A'
                };
              }
            }
          } catch (e) {
            // quote.json also failed, skip this ticker
          }
        }
        
        if (quote && quote.regularMarketPrice > 0) {
          // Ensure ticker exists in performance data
          if (!performanceData[ticker]) {
            // Use alert price from stocks.json if available, otherwise fall back to current price
            const alertPrice = stocksMap[ticker] || quote.regularMarketPrice;
            
            // Initialize with day's high/low, not just current price
            const dayHigh = quote.regularMarketDayHigh || quote.regularMarketPrice;
            const dayLow = quote.regularMarketDayLow || quote.regularMarketPrice;
            
            performanceData[ticker] = {
              alert: alertPrice,
              highest: Math.max(dayHigh, alertPrice),  // Start with whichever is higher (for LONG baseline)
              lowest: Math.min(dayLow, alertPrice),    // Start with whichever is lower (for SHORT baseline)
              current: quote.regularMarketPrice,
              currentPrice: quote.regularMarketPrice,
              volume: quote.regularMarketVolume || 0,
              averageVolume: quote.averageDailyVolume3Month || 0,
              marketCap: quote.marketCap || 'N/A'
            };
          } else {
            // Update with latest price
            performanceData[ticker].currentPrice = quote.regularMarketPrice;
            performanceData[ticker].current = quote.regularMarketPrice;
            performanceData[ticker].volume = quote.regularMarketVolume || 0;
            performanceData[ticker].averageVolume = quote.averageDailyVolume3Month || 0;
            performanceData[ticker].marketCap = quote.marketCap || 'N/A';
            
            // Update high/low - ONLY if this is first time seeing this price
            // Or if it's a new extreme
            const dayHigh = quote.regularMarketDayHigh || quote.regularMarketPrice;
            const dayLow = quote.regularMarketDayLow || quote.regularMarketPrice;
            
            if (dayHigh > (performanceData[ticker].highest || 0)) {
              performanceData[ticker].highest = dayHigh;
            }
            if (dayLow < (performanceData[ticker].lowest || dayLow)) {
              performanceData[ticker].lowest = dayLow;
            }
          }
          
          // Calculate performance percentage based on alert price
          const alertPrice = performanceData[ticker].alert || 0;
          if (alertPrice > 0) {
            const percentChange = ((quote.regularMarketPrice - alertPrice) / alertPrice) * 100;
            performanceData[ticker].performance = parseFloat(percentChange.toFixed(2));
          } else {
            performanceData[ticker].performance = 0;
          }
          
          updated++;
        }
      } catch (err) {
        // Log fetch errors to help debug
        log('DEBUG', `Price fetch failed for ${ticker}: ${err.message}`);
      }
    }
    
    // Save updated performance data
    if (Object.keys(performanceData).length > 0) {
      try {
        const tempFile = CONFIG.PERFORMANCE_FILE + '.tmp';
        fs.writeFileSync(tempFile, JSON.stringify(performanceData, null, 2));
        fs.renameSync(tempFile, CONFIG.PERFORMANCE_FILE);
        // Sync the peak data back to stocks.json immediately after saving
        syncAllPeakData();
      } catch (err) {
        fs.writeFileSync(CONFIG.PERFORMANCE_FILE, JSON.stringify(performanceData, null, 2));
        // Still sync even if temp file failed
        syncAllPeakData();
      }
    }
  } catch (err) {
    log('ERROR', `Background price update failed: ${err.message}`);
  }
};

// Run price updates every 30 seconds
setInterval(updateAllTickerPrices, 30000);
// Also run immediately on startup
updateAllTickerPrices();

// Health monitoring - track memory usage
setInterval(() => {
  const memory = process.memoryUsage();
  const heapUsedMB = Math.round(memory.heapUsed / 1024 / 1024);
  if (heapUsedMB > 500) {
    log('WARN', `High memory: ${heapUsedMB}MB (${Math.round(memory.heapUsed / memory.heapTotal * 100)}% of heap)`);
  }
}, 60000);

// Graceful shutdown handler
process.on('SIGTERM', () => {
  log('INFO', 'Shutdown signal received');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('INFO', 'Application process terminated');
  process.exit(0);
});

// Uncaught error handler
process.on('uncaughtException', (err) => {
  log('ERROR', `Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('ERROR', `Unhandled rejection at ${promise}: ${reason}`);
});