#!/bin/bash

# Daily aggregation cron job
# Add to crontab: 0 0 * * * /path/to/daily-aggregation.sh

API_URL="http://localhost:3000"
LOG_FILE="/var/log/server-api/cron.log"

echo "$(date): Running daily aggregation..." >> "$LOG_FILE"

# Trigger daily aggregation
curl -X POST "$API_URL/api/admin/aggregate-daily" >> "$LOG_FILE" 2>&1

echo "$(date): Daily aggregation complete" >> "$LOG_FILE"
