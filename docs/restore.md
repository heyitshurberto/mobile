# Restore stocks.json & alert.json From Backup

## Script to Restore Files From X Hours Ago

Save this as a file called `restore_files.sh` in your main folder:

```bash
#!/bin/bash

# Usage: ./restore_files.sh <hours_back> <filename1> <filename2> ...
# Example: ./restore_files.sh 6 logs/stocks.json logs/alert.json

GIST_ID="e101cc0739b67d7f32aa9b678a0d6c06"
HOURS_BACK=${1:-4}
shift
FILES=("$@")

if [ ${#FILES[@]} -eq 0 ]; then
    echo "Usage: $0 <hours_back> <file1> <file2> ..."
    exit 1
fi

echo "Fetching gist history..."
REVISIONS=$(curl -s "https://api.github.com/gists/$GIST_ID/commits?per_page=500")

REVISION=$(python3 << 'EOF'
import json
import sys
from datetime import datetime, timedelta, timezone

revisions = json.loads(''''"$REVISIONS"'''')
target_time = datetime.now(timezone.utc) - timedelta(hours=$HOURS_BACK)

for rev in revisions:
    rev_time = datetime.fromisoformat(rev['committed_at'].replace('Z', '+00:00'))
    if rev_time < target_time:
        print(rev['version'])
        sys.exit(0)

print(revisions[-1]['version'])
EOF
)

if [ -z "$REVISION" ]; then
    echo "Error: Could not find revision"
    exit 1
fi

echo "Found revision: $REVISION (from $HOURS_BACK hours ago)"

for file in "${FILES[@]}"; do
    echo "Downloading $file..."
    curl -s "https://gist.githubusercontent.com/heyitshurberto/$GIST_ID/raw/$REVISION/$file" > "$file"
done

echo "Committing and pushing..."
git add "${FILES[@]}"
git commit -m "Restore files to $HOURS_BACK hours ago (revision $REVISION)"
git push origin main

echo "Done! Files restored and pushed to GitHub."
```

### How to Use It

1. **Save the script above** as `restore_files.sh` in your main folder
2. **Make it runnable:**
   ```bash
   chmod +x restore_files.sh
   ```

3. **Use it when you need to restore:**
   ```bash
   # Restore from 3 hours ago
   ./restore_files.sh 3 logs/stocks.json logs/alert.json
   
   # Restore from 6 hours ago
   ./restore_files.sh 6 logs/stocks.json logs/alert.json
   
   # Restore from 24 hours ago
   ./restore_files.sh 24 logs/stocks.json logs/alert.json
   ```
