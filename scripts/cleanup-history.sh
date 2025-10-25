#!/bin/bash

# Weekly cleanup cron job
# Add to crontab: 0 2 * * 0 /path/to/cleanup-history.sh

API_URL="http://localhost:3000"
LOG_FILE="/var/log/server-api/cron.log"
RETENTION_DAYS=30

echo "$(date): Running history cleanup (${RETENTION_DAYS} days)..." >> "$LOG_FILE"

# Trigger cleanup
curl -X POST "$API_URL/api/admin/cleanup-history?days=${RETENTION_DAYS}" >> "$LOG_FILE" 2>&1

echo "$(date): History cleanup complete" >> "$LOG_FILE"
