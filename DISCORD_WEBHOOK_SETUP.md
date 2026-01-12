# Discord Notifications Setup

The GitHub Actions workflow now sends pipeline completion notifications to Discord.

## Setup Instructions

1. **Create a Discord Webhook**
   - Go to your Discord server settings
   - Select "Integrations" → "Webhooks"
   - Click "Create Webhook"
   - Copy the webhook URL

2. **Add to GitHub Secrets**
   - Go to repository settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `DISCORD_WEBHOOK`
   - Value: [paste your webhook URL]
   - Click "Add secret"

3. **Done!**
   - Next time the pipeline runs, it will post a message to your Discord channel
   - Success messages show all metrics (jobs, companies, leads, uploads)
   - Failure messages show the error that occurred

## Example Messages

**Success:**
```
✅ Pipeline Complete
Jobs Scraped          | 2000
Companies Filtered    | 150
Decision Makers       | 450
Leads Enriched        | 380
Leads Validated       | 380
Email Uploads         | 200
LinkedIn Uploads      | 180
Run #123
```

**Failure:**
```
❌ Pipeline Failed
Error | No decision makers found
Run #124
```
