#!/usr/bin/env python3
"""
Check alert performance - fetches live prices for tickers
Run: python3 check.py
"""

import csv
import json
import sys
import os
import urllib.request
import urllib.error
import time
import random
from datetime import datetime

# Rate limiting constants
REQUEST_DELAY = 0.2  # 200ms delay between requests
MAX_REQUESTS_PER_BATCH = 50  # After 50 requests, add extra delay
BATCH_DELAY = 0.5  # 0.5 second delay after every 50 requests
TIMEOUT = 5  # Timeout for API requests in seconds

# Load API key from .env
FINNHUB_API_KEY = None
if os.path.exists('.env'):
    with open('.env', 'r') as f:
        for line in f:
            if line.startswith('FINNHUB_API_KEY='):
                FINNHUB_API_KEY = line.split('=', 1)[1].strip()
                break

def fetch_stock_price(ticker, request_count, max_retries=3):
    """Fetch live stock price and peak prices from Finnhub with rate limiting and retries"""
    if not FINNHUB_API_KEY:
        return None, None, None, request_count
    
    for attempt in range(max_retries):
        # Rate limiting: pause after every 30 requests (silently, no log)
        if request_count > 0 and request_count % MAX_REQUESTS_PER_BATCH == 0:
            time.sleep(BATCH_DELAY)
        
        # Small delay before each request
        time.sleep(REQUEST_DELAY + random.uniform(0, 0.1))
        
        try:
            url = f"https://finnhub.io/api/v1/quote?symbol={ticker}&token={FINNHUB_API_KEY}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
                data = json.loads(response.read().decode())
                if 'c' in data and data['c']:  # c = current price, h = high, l = low
                    current = float(data['c'])
                    high = float(data.get('h', current))  # daily high
                    low = float(data.get('l', current))   # daily low
                    return current, high, low, request_count + 1
                elif attempt < max_retries - 1:
                    # Retry if no price data received
                    time.sleep(1)
                    continue
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, Exception) as e:
            # Retry on errors except on last attempt
            if attempt < max_retries - 1:
                time.sleep(1 + (attempt * 0.5))  # Exponential backoff
                continue
    
    return None, None, None, request_count + 1

def calculate_metrics(rows, perf_dict=None):
    """Calculate basic performance metrics using live performance data"""
    if perf_dict is None:
        perf_dict = {}
    
    total_trades = len(rows)
    winning_trades = 0
    losing_trades = 0
    long_trades = 0
    short_trades = 0
    total_return = 0
    
    for row in rows:
        try:
            ticker = row.get('Ticker', '').strip()
            if not ticker or ticker == 'Unknown':
                continue
            
            # Track direction from skip reason
            skip_reason = row.get('Skip Reason', '')
            if '[SHORT]' in skip_reason:
                short_trades += 1
            elif '[LONG]' in skip_reason:
                long_trades += 1
            
            # Get performance from perf_dict
            if ticker in perf_dict:
                move_pct = perf_dict[ticker]['move_pct']
                total_return += move_pct
                if move_pct > 0:
                    winning_trades += 1
                elif move_pct < 0:
                    losing_trades += 1
        except Exception as e:
            continue
    
    win_rate = (winning_trades / (winning_trades + losing_trades) * 100) if (winning_trades + losing_trades) > 0 else 0
    avg_return = total_return / len(rows) if len(rows) > 0 else 0
    
    return {
        'total_trades': total_trades,
        'win_rate': round(win_rate, 1),
        'avg_return': round(avg_return, 1),
        'winning_trades': winning_trades,
        'losing_trades': losing_trades,
        'long_trades': long_trades,
        'short_trades': short_trades
    }

def calculate_technical_metrics(rows):
    """Calculate F/AV, S/O, Volume metrics"""
    total_rows = 0
    fav_ratios = []  # Float / Average Volume
    vol_ratios = []  # Volume / Average Volume
    so_ratios = []   # Shares Outstanding ratios
    float_values = []
    
    for row in rows:
        try:
            ticker = row.get('Ticker', '').strip()
            if not ticker or ticker == 'Unknown':
                continue
            
            # Parse Float and Shares Outstanding
            float_str = row.get('Float', '0').replace(',', '')
            shares_str = row.get('Shares Outstanding', '0').replace(',', '')
            volume_str = row.get('Volume', '0').replace(',', '')
            avg_vol_str = row.get('Average Volume', '0').replace(',', '')
            
            float_val = float(float_str) if float_str else 0
            shares_val = float(shares_str) if shares_str else 0
            volume_val = float(volume_str) if volume_str else 0
            avg_vol_val = float(avg_vol_str) if avg_vol_str else 0
            
            if avg_vol_val > 0:
                # F/AV: Float / Average Volume (days of float turnover)
                fav = float_val / avg_vol_val if float_val > 0 else 0
                if fav > 0:
                    fav_ratios.append(fav)
                
                # V/AV: Volume / Average Volume
                vol_ratio = volume_val / avg_vol_val if volume_val > 0 else 0
                if vol_ratio > 0:
                    vol_ratios.append(vol_ratio)
            
            if shares_val > 0 and float_val > 0:
                # S/O: Float / Shares Outstanding
                so_pct = (float_val / shares_val) * 100
                so_ratios.append(so_pct)
                float_values.append(float_val)
            
            total_rows += 1
        except Exception as e:
            continue
    
    # Calculate statistics
    def get_stats(values):
        if not values:
            return {'min': 0, 'max': 0, 'avg': 0, 'median': 0, 'count': 0}
        sorted_vals = sorted(values)
        return {
            'min': min(values),
            'max': max(values),
            'avg': sum(values) / len(values),
            'median': sorted_vals[len(sorted_vals) // 2],
            'count': len(values)
        }
    
    return {
        'fav': get_stats(fav_ratios),
        'vol_ratio': get_stats(vol_ratios),
        'so': get_stats(so_ratios),
        'float': get_stats(float_values)
    }

def analyze_signals(rows):
    """Analyze which signals appear most frequently - extract from Skip Reason"""
    signal_counts = {}
    signal_tickers = {}
    
    for row in rows:
        skip_reason = row.get('Skip Reason', '')
        ticker = row.get('Ticker', '')
        
        # Extract catalysts from Skip Reason (e.g., "Alert sent: [LONG] Merger/Acquisition, FDA Filing, Asset Disposition")
        if 'Alert sent:' in skip_reason:
            # Parse catalysts after the alert direction
            parts = skip_reason.split('Alert sent:')
            if len(parts) > 1:
                alert_part = parts[1].strip()
                # Extract direction and catalysts
                if '[LONG]' in alert_part or '[SHORT]' in alert_part:
                    # Remove direction markers
                    alert_part = alert_part.replace('[LONG]', '').replace('[SHORT]', '').strip()
                    # Split by comma to get individual catalysts
                    catalysts = [c.strip() for c in alert_part.split(',')]
                    for cat in catalysts:
                        if cat and cat != 'N/A':
                            signal_counts[cat] = signal_counts.get(cat, 0) + 1
                            if cat not in signal_tickers:
                                signal_tickers[cat] = []
                            signal_tickers[cat].append(ticker)
    
    return {
        'signal_counts': signal_counts,
        'signal_tickers': signal_tickers
    }

def time_analysis(rows):
    """Analyze filing times - when do filings occur?"""
    time_buckets = {
        'Pre-Market (4am-9:30am)': [],
        'Market Open (9:30am-12pm)': [],
        'Afternoon (12pm-4pm)': [],
        'After-Hours (4pm-8pm)': [],
        'Late Night (8pm-4am)': []
    }
    
    for row in rows:
        filed_time = row.get('Filed Time', '')
        if filed_time and filed_time != 'N/A':
            try:
                hour = float(filed_time.split(':')[0])
                
                if 4 <= hour < 9.5:
                    bucket = 'Pre-Market (4am-9:30am)'
                elif 9.5 <= hour < 12:
                    bucket = 'Market Open (9:30am-12pm)'
                elif 12 <= hour < 16:
                    bucket = 'Afternoon (12pm-4pm)'
                elif 16 <= hour < 20:
                    bucket = 'After-Hours (4pm-8pm)'
                else:
                    bucket = 'Late Night (8pm-4am)'
                
                time_buckets[bucket].append(row.get('Ticker', ''))
            except:
                continue
    
    return time_buckets

def country_analysis(rows):
    """Analyze geographic distribution"""
    country_counts = {}
    country_tickers = {}
    
    for row in rows:
        country = row.get('Incorporated', 'Unknown')
        if not country or country == 'N/A':
            country = 'Unknown'
        
        country_counts[country] = country_counts.get(country, 0) + 1
        if country not in country_tickers:
            country_tickers[country] = []
        country_tickers[country].append(row.get('Ticker', ''))
    
    return {
        'country_counts': country_counts,
        'country_tickers': country_tickers
    }

def calculate_pnl(rows):
    """Simple P&L count based on CSV data"""
    trades = []
    
    for row in rows:
        ticker = row.get('Ticker', '')
        if not ticker or ticker == 'Unknown':
            continue
        
        try:
            alert_price = float(row.get('Price', 0))
            if alert_price <= 0:
                continue
            
            skip_reason = row.get('Skip Reason', '')
            is_short = '[SHORT]' in skip_reason
            
            trades.append({
                'ticker': ticker,
                'entry': alert_price,
                'type': 'SHORT' if is_short else 'LONG',
                'filed_date': row.get('Filed Date', '')
            })
        except:
            continue
    
    return {
        'total_trades': len(trades),
        'trades': trades,
        'top_5_winners': trades[:5],
        'top_5_losers': trades[-5:]
    }

def daily_summary(rows):
    """Summary for today's filings"""
    today = datetime.now().strftime('%Y-%m-%d')
    today_trades = []
    
    for row in rows:
        filed_date = row.get('Filed Date', '')
        if filed_date == today:
            today_trades.append(row)
    
    return {
        'date': today,
        'count': len(today_trades),
        'tickers': [r.get('Ticker', '') for r in today_trades]
    }

def skip_reason_analysis(rows):
    """Analyze why trades were skipped"""
    skip_reasons = {}
    skip_tickers = {}
    
    for row in rows:
        skip_reason = row.get('Skip Reason', '')
        ticker = row.get('Ticker', '')
        
        if skip_reason and 'Alert sent' not in skip_reason:
            # Extract main reason
            if '(' in skip_reason:
                main_reason = skip_reason.split('(')[0].strip()
            else:
                main_reason = skip_reason.strip()
            
            skip_reasons[main_reason] = skip_reasons.get(main_reason, 0) + 1
            if main_reason not in skip_tickers:
                skip_tickers[main_reason] = []
            skip_tickers[main_reason].append(ticker)
    
    return {
        'skip_reasons': skip_reasons,
        'skip_tickers': skip_tickers
    }

def alert_type_analysis(rows):
    """Analyze which alert types work best (LONG vs SHORT)"""
    alert_types = {'LONG': {'count': 0, 'tickers': []},
                   'SHORT': {'count': 0, 'tickers': []},
                   'PASSED': {'count': 0, 'tickers': []}}
    
    for row in rows:
        skip_reason = row.get('Skip Reason', '')
        ticker = row.get('Ticker', '')
        
        if not ticker or ticker == 'Unknown':
            continue
        
        if '[LONG]' in skip_reason:
            alert_types['LONG']['count'] += 1
            alert_types['LONG']['tickers'].append(ticker)
        elif '[SHORT]' in skip_reason:
            alert_types['SHORT']['count'] += 1
            alert_types['SHORT']['tickers'].append(ticker)
        else:
            alert_types['PASSED']['count'] += 1
            alert_types['PASSED']['tickers'].append(ticker)
    
    return alert_types

def price_range_analysis(rows):
    """Analyze performance by price range"""
    price_ranges = {
        'Penny (< $1)': {'count': 0},
        'Micro ($1-$5)': {'count': 0},
        'Small ($5-$20)': {'count': 0},
        'Mid ($20-$100)': {'count': 0},
        'Large (> $100)': {'count': 0}
    }
    
    for row in rows:
        ticker = row.get('Ticker', '')
        price_str = row.get('Price', '')
        
        try:
            alert_price = float(price_str) if price_str and price_str != 'N/A' else 0
        except (ValueError, TypeError):
            alert_price = 0
        
        if alert_price <= 0 or not ticker or ticker == 'Unknown':
            continue
        
        # Determine range
        if alert_price < 1:
            bucket = 'Penny (< $1)'
        elif alert_price < 5:
            bucket = 'Micro ($1-$5)'
        elif alert_price < 20:
            bucket = 'Small ($5-$20)'
        elif alert_price < 100:
            bucket = 'Mid ($20-$100)'
        else:
            bucket = 'Large (> $100)'
        
        price_ranges[bucket]['count'] += 1
    
    return price_ranges

def filing_type_analysis(rows):
    """Analyze performance by filing type"""
    filing_types = {}
    
    for row in rows:
        ticker = row.get('Ticker', '')
        filing_type = row.get('Filing Type', 'N/A')
        price_str = row.get('Price', '')
        
        try:
            alert_price = float(price_str) if price_str and price_str != 'N/A' else 0
        except (ValueError, TypeError):
            alert_price = 0
        
        if alert_price <= 0 or not ticker or ticker == 'Unknown':
            continue
        
        if filing_type == 'N/A' or not filing_type:
            continue
        
        # Parse multiple filing types
        types = [t.strip() for t in filing_type.split(',')]
        for ftype in types:
            if ftype not in filing_types:
                filing_types[ftype] = {'count': 0, 'tickers': []}
            filing_types[ftype]['count'] += 1
            filing_types[ftype]['tickers'].append(ticker)
    
    return filing_types

def catalyst_performance(rows):
    """Detailed catalyst performance - extract from Skip Reason"""
    catalysts = {}
    
    for row in rows:
        ticker = row.get('Ticker', '')
        skip_reason = row.get('Skip Reason', '')
        
        if not ticker or ticker == 'Unknown':
            continue
        
        # Extract catalysts from Skip Reason where Alert sent data is stored
        if 'Alert sent:' in skip_reason:
            parts = skip_reason.split('Alert sent:')
            if len(parts) > 1:
                alert_part = parts[1].strip()
                # Remove direction markers
                alert_part = alert_part.replace('[LONG]', '').replace('[SHORT]', '').strip()
                # Split by comma to get individual catalysts
                catalyst_list = [c.strip() for c in alert_part.split(',')]
                for cat in catalyst_list:
                    if cat and cat != 'N/A':
                        if cat not in catalysts:
                            catalysts[cat] = {'count': 0, 'tickers': []}
                        catalysts[cat]['count'] += 1
                        catalysts[cat]['tickers'].append(ticker)
    
    return catalysts

def weighted_performance_analysis(rows, perf_dict):
    """Calculate weighted win rates for catalysts, countries, times, filing types"""
    
    analysis = {
        'catalysts': {},
        'countries': {},
        'times': {},
        'filing_types': {},
        'price_ranges': {},
    }
    
    for row in rows:
        try:
            ticker = row.get('Ticker', '').strip()
            if not ticker or ticker == 'Unknown' or ticker not in perf_dict:
                continue
            
            perf = perf_dict[ticker]
            move_pct = perf['move_pct']
            # Only count trades with 20%+ move in either direction
            is_winner = (move_pct >= 20 or move_pct <= -20)
            
            # Extract catalyst
            skip_reason = row.get('Skip Reason', '')
            if 'Alert sent:' in skip_reason:
                catalyst_part = skip_reason.split('Alert sent:')[1].split('[')[0].strip()
                catalysts = [c.strip() for c in catalyst_part.split(',') if c.strip()]
                for cat in catalysts:
                    if cat and len(cat) > 2:
                        if cat not in analysis['catalysts']:
                            analysis['catalysts'][cat] = {'total': 0, 'winners': 0, 'movers': []}
                        analysis['catalysts'][cat]['total'] += 1
                        if is_winner:
                            analysis['catalysts'][cat]['winners'] += 1
                            analysis['catalysts'][cat]['movers'].append((ticker, move_pct))
            
            # Country
            located = row.get('Located', 'Unknown').strip()
            if located:
                if located not in analysis['countries']:
                    analysis['countries'][located] = {'total': 0, 'winners': 0, 'movers': []}
                analysis['countries'][located]['total'] += 1
                if is_winner:
                    analysis['countries'][located]['winners'] += 1
                    analysis['countries'][located]['movers'].append((ticker, move_pct))
            
            # Filing time
            filed_time = row.get('Filed Time', '').strip()
            if filed_time:
                try:
                    hour = int(filed_time.split(':')[0])
                    if 4 <= hour < 9:
                        time_bucket = 'Pre-Market (4-9am)'
                    elif 9 <= hour < 12:
                        time_bucket = 'Market Open (9-12pm)'
                    elif 12 <= hour < 16:
                        time_bucket = 'Afternoon (12-4pm)'
                    elif 16 <= hour < 20:
                        time_bucket = 'After-Hours (4-8pm)'
                    else:
                        time_bucket = 'Late Night (8pm-4am)'
                    
                    if time_bucket not in analysis['times']:
                        analysis['times'][time_bucket] = {'total': 0, 'winners': 0, 'movers': []}
                    analysis['times'][time_bucket]['total'] += 1
                    if is_winner:
                        analysis['times'][time_bucket]['winners'] += 1
                        analysis['times'][time_bucket]['movers'].append((ticker, move_pct))
                except:
                    pass
            
            # Filing type
            filing_type = row.get('Filing Type', 'N/A').strip()
            if filing_type and filing_type != 'N/A':
                if filing_type not in analysis['filing_types']:
                    analysis['filing_types'][filing_type] = {'total': 0, 'winners': 0, 'movers': []}
                analysis['filing_types'][filing_type]['total'] += 1
                if is_winner:
                    analysis['filing_types'][filing_type]['winners'] += 1
                    analysis['filing_types'][filing_type]['movers'].append((ticker, move_pct))
            
            # Price range
            try:
                price = float(row.get('Price', 0) or 0)
                if price < 1:
                    price_range = 'Penny (<$1)'
                elif price < 5:
                    price_range = 'Micro ($1-5)'
                elif price < 20:
                    price_range = 'Small ($5-20)'
                elif price < 100:
                    price_range = 'Mid ($20-100)'
                else:
                    price_range = 'Large (>$100)'
                
                if price_range not in analysis['price_ranges']:
                    analysis['price_ranges'][price_range] = {'total': 0, 'winners': 0, 'movers': []}
                analysis['price_ranges'][price_range]['total'] += 1
                if is_winner:
                    analysis['price_ranges'][price_range]['winners'] += 1
                    analysis['price_ranges'][price_range]['movers'].append((ticker, move_pct))
            except:
                pass
        
        except Exception as e:
            pass
    
    # Calculate win rates for each dimension
    for dimension in analysis:
        for key in list(analysis[dimension].keys()):
            data = analysis[dimension][key]
            if data['total'] >= 3:  # Minimum 3 trades to be meaningful
                data['win_rate'] = (data['winners'] / data['total'] * 100)
            else:
                del analysis[dimension][key]  # Remove low-sample dimensions
    
    return analysis

def main():
    # Load data from track.csv with proper handling for column misalignment
    try:
        with open('logs/track.csv', 'r') as f:
            csv_reader = csv.reader(f)
            header = next(csv_reader)
            rows = []
            for line in csv_reader:
                # Create dict using actual column count
                row_dict = {}
                for i, key in enumerate(header):
                    if i < len(line):
                        row_dict[key] = line[i]
                # Always use the actual last column as Skip Reason
                if len(line) > len(header):
                    row_dict['Skip Reason'] = line[-1]
                elif 'Skip Reason' in header:
                    idx = header.index('Skip Reason')
                    if idx < len(line):
                        row_dict['Skip Reason'] = line[idx]
                rows.append(row_dict)
    except FileNotFoundError:
        print("ERROR: No track.csv found.")
        sys.exit(1)
    
    if not rows:
        print("ERROR: track.csv is empty")
        sys.exit(1)
    
    # Get unique tickers from track.csv
    tickers = set()
    for row in rows:
        ticker = row.get('Ticker', '').strip()
        if ticker and ticker != 'Unknown':
            tickers.add(ticker)
    
    if not tickers:
        print("ERROR: No valid tickers in CSV")
        sys.exit(1)
    
    print(f"\nAlerts ({len(tickers)})")
    print("-" * 180)
    print(f"{'Ticker':<8} {'Alert':<10} {'Current':<10} {'Peak':<10} {'Change':<10} {'Dir':<6} {'Incorporated':<20} {'Located':<20} {'Signals':<60} {'Float':<15} {'S/O%':<10} {'F/AV':<8} {'Filed':<16}")
    print("-" * 180)
    
    total_move = 0
    winners = 0
    count = 0
    request_count = 0
    big_movers = []
    na_tickers = []
    
    for ticker in sorted(tickers):
        ticker_rows = [r for r in rows if r.get('Ticker') == ticker]
        if not ticker_rows:
            continue
        
        try:
            alert_price = float(ticker_rows[0].get('Price', 0))
        except ValueError:
            continue
        
        skip_reason = ticker_rows[0].get('Skip Reason', '')
        # If Skip Reason column is not found, it might be the last column due to CSV formatting
        if not skip_reason or skip_reason == '':
            # Try to get it from the raw row values as the last non-empty field
            all_vals = list(ticker_rows[0].values())
            if all_vals:
                skip_reason = all_vals[-1] if all_vals[-1] else ''
        # Remove bonus filter text for cleaner display
        if '(Bonus:' in skip_reason:
            skip_reason = skip_reason.split('(Bonus:')[0].strip()
        incorporated = ticker_rows[0].get('Incorporated', 'N/A')
        located = ticker_rows[0].get('Located', 'N/A')
        filed_date = ticker_rows[0].get('Filed Date', 'N/A')
        filed_time = ticker_rows[0].get('Filed Time', 'N/A')
        if filed_date != 'N/A' and filed_time != 'N/A':
            filed_display = f"{filed_date} {filed_time[:5]}"
        else:
            filed_display = filed_date[:10] if filed_date != 'N/A' else 'N/A'
        
        # Fetch live prices from API
        current, high, low, request_count = fetch_stock_price(ticker, request_count)
        
        if current is None:
            current = alert_price
            high = alert_price
            low = alert_price
        
        current_str = f"${current:.2f}"
        
        if current:
            # Calculate peak price (highest or lowest since alert, whichever is more extreme)
            peak_price = max(high, alert_price) if current > alert_price else min(low, alert_price)
            peak_str = f"${peak_price:.2f}"
            peak_move_pct = ((peak_price - alert_price) / alert_price) * 100
            
            move_pct = ((current - alert_price) / alert_price) * 100
            
            if current > alert_price:
                count += 1
                total_move += move_pct
                if move_pct > 50:
                    winners += 1
                elif move_pct > 20:
                    winners += 1
                elif move_pct > 0:
                    winners += 1
            elif current < alert_price:
                count += 1
                total_move += move_pct
            
            move_str = f"{move_pct:+.1f}%"
            
            # Track big movers (10% +/- threshold) but exclude extreme outliers (700%+ = reverse split artifacts)
            if abs(move_pct) >= 10 and abs(move_pct) < 700:
                big_movers.append({
                    'ticker': ticker,
                    'alert_price': alert_price,
                    'current_price': current,
                    'peak_price': peak_price,
                    'move_pct': move_pct,
                    'peak_move_pct': peak_move_pct,
                    'skip_reason': skip_reason,
                    'incorporated': incorporated,
                    'located': located,
                    'filed_display': filed_display
                })
        else:
            peak_str = "N/A"
            move_str = "N/A"
            na_tickers.append({'ticker': ticker, 'skip_reason': skip_reason})
        
        alert_str = f"${alert_price:.2f}"
        so_ratio = ticker_rows[0].get('S/O Ratio', 'N/A')
        direction = ticker_rows[0].get('Direction', '')
        # Default to N/A if direction is empty or not present
        if not direction or direction.strip() == '':
            direction = 'N/A'
        float_val = ticker_rows[0].get('Float', 'N/A')
        volume_val = ticker_rows[0].get('Volume', 'N/A')
        avg_volume_val = ticker_rows[0].get('Average Volume', 'N/A')
        
        # Calculate F/AV ratio (Float / Average Volume)
        fav_ratio = 'N/A'
        try:
            if float_val != 'N/A' and avg_volume_val != 'N/A':
                flt = float(float_val)
                avg_vol = float(avg_volume_val)
                if avg_vol > 0:
                    fav_ratio = f"{(flt / avg_vol):.2f}x"
        except (ValueError, TypeError):
            pass
        
        # Extract signals/catalysts - first try Skip Reason, then fall back to Catalyst column
        signals_display = 'N/A'
        if 'Alert sent:' in skip_reason:
            signal_part = skip_reason.split('Alert sent:')[1].split('(')[0].strip()
            signal_part = signal_part.replace('[LONG]', '').replace('[SHORT]', '').strip()
            signals_display = signal_part
        else:
            # Try to get from Catalyst column
            catalyst = ticker_rows[0].get('Catalyst', 'N/A')
            if catalyst and catalyst != 'N/A':
                signals_display = str(catalyst)
        
        print(f"{ticker:<8} {alert_str:<10} {current_str:<10} {peak_str:<10} {move_str:<10} {str(direction):<8} {incorporated:<28} {located:<20} {signals_display} Float: {str(float_val):<10} S/O: {str(so_ratio):<6} F/AV: {str(fav_ratio):<6} {filed_display}")
    
    print("-" * 220)
    avg_move = total_move / count if count > 0 else 0
    print(f"Average: {avg_move:+.1f}%")
    print(f"Successful: {winners}/{count}")
    print(f"Rate limited after 30 requests (N/A count: {len(na_tickers)})\n")
    
    # Summary of big movers (>= 10%)
    if big_movers:
        print("\n" + "="*180)
        print(f"BIG MOVERS (>= 10% +/- threshold): {len(big_movers)} stocks")
        print("="*180)
        print(f"{'Ticker':<8} {'Alert Price':<12} {'Current':<12} {'Peak':<12} {'Move %':<10} {'Peak %':<10} {'Inc':<12} {'Ops':<12} {'Filed':<19} {'Skip Reason'}")
        print("-"*180)
        for mover in sorted(big_movers, key=lambda x: abs(x['move_pct']), reverse=True):
            inc = mover.get('incorporated', 'N/A')[:10]
            ops = mover.get('located', 'N/A')[:10]
            filed = mover.get('filed_display', 'N/A')
            print(f"{mover['ticker']:<8} ${mover['alert_price']:<11.2f} ${mover['current_price']:<11.2f} ${mover['peak_price']:<11.2f} {mover['move_pct']:+.1f}%{'':<3} {mover['peak_move_pct']:+.1f}%{'':<2} {inc:<12} {ops:<12} {filed:<19} {mover['skip_reason']}")
    
    # Summary of N/A (rate limited)
    if na_tickers:
        print("\n" + "="*180)
        print(f"RATE LIMITED / NOT AVAILABLE: {len(na_tickers)} stocks (exceeded 30 req limit)")
        print("="*180)
        print(f"{'Ticker':<8} {'Skip Reason'}")
        print("-"*180)
        for na in sorted(na_tickers, key=lambda x: x['ticker']):
            print(f"{na['ticker']:<8} {na['skip_reason']}")
    
    # ============================================================================
    # COMPREHENSIVE ANALYTICS SECTION
    # ============================================================================
    # Build performance lookup dict from main loop data
    perf_dict = {}
    for mover in big_movers:
        perf_dict[mover['ticker']] = {
            'alert_price': mover['alert_price'],
            'current': mover['current_price'],
            'peak': mover['peak_price'],
            'move_pct': mover['move_pct'],
            'peak_move_pct': mover['peak_move_pct']
        }
    
    print("\n" + "="*160)
    print("ALERT PERFORMANCE ANALYSIS")
    print("="*160)
    
    # CORE METRICS
    print("\n📊 CORE METRICS")
    print("-" * 160)
    metrics = calculate_metrics(rows, perf_dict)
    print(f"Total: {metrics['total_trades']} | Wins: {metrics['winning_trades']} | Losses: {metrics['losing_trades']} | Rate: {metrics['win_rate']:.1f}% | Avg Return: {metrics['avg_return']:+.1f}%")
    print(f"LONG: {metrics['long_trades']} | SHORT: {metrics['short_trades']}")
    
    # TECHNICAL METRICS (condensed)
    print("\n📈 TECHNICAL METRICS")
    print("-" * 160)
    tech_metrics = calculate_technical_metrics(rows)
    fav = tech_metrics['fav']
    vol = tech_metrics['vol_ratio']
    flt = tech_metrics['float']
    print(f"F/AV Ratio:     Min {fav['min']:.1f}x | Max {fav['max']:.1f}x | Med {fav['median']:.1f}x | Sweet Spot: 3-30x")
    print(f"Volume Ratio:   Min {vol['min']:.2f}x | Max {vol['max']:.2f}x | Med {vol['median']:.2f}x")
    print(f"Float:          Min {flt['min']:,.0f} | Max {flt['max']:,.0f} | Med {flt['median']:,.0f}")
    
    # WINNING PATTERNS (focus on what works)
    print("\n🎯 WINNING PATTERNS (20%+ moves only)")
    print("-" * 160)
    weighted = weighted_performance_analysis(rows, perf_dict)
    
    print("Best Catalysts:")
    sorted_cats = sorted(weighted['catalysts'].items(), key=lambda x: x[1]['win_rate'], reverse=True)[:5]
    for cat, data in sorted_cats:
        if data['total'] >= 3:
            print(f"  • {cat:<40} {data['win_rate']:>6.1f}% WR ({data['winners']}/{data['total']} wins)")
    
    print("\nBest Geographies:")
    sorted_geo = sorted(weighted['countries'].items(), key=lambda x: x[1]['win_rate'], reverse=True)[:5]
    for country, data in sorted_geo:
        if data['total'] >= 3:
            print(f"  • {country:<40} {data['win_rate']:>6.1f}% WR ({data['winners']}/{data['total']} wins)")
    
    print("\nBest Times:")
    sorted_times = sorted(weighted['times'].items(), key=lambda x: x[1]['win_rate'], reverse=True)
    for time, data in sorted_times:
        if data['total'] >= 3:
            print(f"  • {time:<40} {data['win_rate']:>6.1f}% WR ({data['winners']}/{data['total']} wins)")
    
    print("\nBest Price Ranges:")
    sorted_prices = sorted(weighted['price_ranges'].items(), key=lambda x: x[1]['win_rate'], reverse=True)
    for price, data in sorted_prices:
        if data['total'] >= 3:
            print(f"  • {price:<40} {data['win_rate']:>6.1f}% WR ({data['winners']}/{data['total']} wins)")
    
    # SIGNAL FREQUENCY (top 10 only)
    print("\n📋 TOP SIGNALS")
    print("-" * 160)
    signals = analyze_signals(rows)
    if signals['signal_counts']:
        top_signals = sorted(signals['signal_counts'].items(), key=lambda x: x[1], reverse=True)[:10]
        for i, (signal, count) in enumerate(top_signals, 1):
            pct = (count / len(rows)) * 100
            print(f"{i:>2}. {signal:<45} {count:>3} ({pct:>4.1f}%)")
    
    # ALL SIGNALS MENTIONED
    print("\n🔤 ALL SIGNALS MENTIONED")
    print("-" * 160)
    if signals['signal_counts']:
        all_signals = sorted(signals['signal_counts'].items(), key=lambda x: x[1], reverse=True)
        for signal, count in all_signals:
            pct = (count / len(rows)) * 100
            print(f"  • {signal:<50} {count:>3} ({pct:>4.1f}%)")
    
    # GEOGRAPHY (top 10 only)
    print("\n🌍 TOP JURISDICTIONS")
    print("-" * 160)
    countries = country_analysis(rows)
    sorted_countries = sorted(countries['country_counts'].items(), key=lambda x: x[1], reverse=True)[:10]
    for i, (country, count) in enumerate(sorted_countries, 1):
        pct = (count / len(rows)) * 100
        print(f"{i:>2}. {country:<45} {count:>3} ({pct:>4.1f}%)")
    
    # FILING TIMES
    print("\n⏰ FILING TIMES")
    print("-" * 160)
    times = time_analysis(rows)
    for bucket, tickers in sorted(times.items()):
        pct = (len(tickers) / len(rows)) * 100 if rows else 0
        print(f"{bucket:<35} {len(tickers):>4} ({pct:>5.1f}%)")
    
    # SKIP REASONS (top 5)
    print("\n❌ TOP REJECTION REASONS")
    print("-" * 160)
    skip_analysis = skip_reason_analysis(rows)
    if skip_analysis['skip_reasons']:
        top_skips = sorted(skip_analysis['skip_reasons'].items(), key=lambda x: x[1], reverse=True)[:5]
        for i, (reason, count) in enumerate(top_skips, 1):
            pct = (count / len(rows)) * 100 if rows else 0
            print(f"{i}. {reason:<50} {count:>3} ({pct:>4.1f}%)")
    
    # TODAY
    print("\n📅 TODAY'S FILINGS")
    print("-" * 160)
    today = daily_summary(rows)
    print(f"Date: {today['date']}")
    print(f"Count: {today['count']}")
    if today['count'] > 0:
        print(f"Tickers: {', '.join(today['tickers'])}")
    else:
        print("None")
    
    print("\n" + "="*160)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Exiting gracefully...")
        sys.exit(0)
