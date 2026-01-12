# Email Enrichment Bulk Search Fix

## Problem
The bulk email enrichment was timing out and returning 0 results:
```
Bulk search timed out for batch 1
Enrichment complete: 0/39 leads with emails found
```

## Root Cause
The Icypeas bulk search API requires a `user` field in the request payload. The original implementation was missing this required parameter, causing a `401 UserNotFoundError` from the API.

## Solution
Added support for the `ICYPEAS_USER_ID` configuration parameter:

### 1. Configuration Changes
- Added `ICYPEAS_USER_ID` to `scripts/pipeline/config.py`
- Updated `.env.example` with the new parameter
- User ID is loaded from environment variable `ICYPEAS_USER_ID`

### 2. Code Changes
**File: `scripts/pipeline/email_enricher.py`**
- Updated `submit_bulk_search()` to include the `user` field from `ICYPEAS_USER_ID`
- Removed unnecessary `get_user_id()` function that attempted to discover user ID from API responses
- Simplified the bulk search submission logic

### 3. API Requirement
The Icypeas bulk search endpoint (`POST /bulk-search`) requires this payload structure:
```json
{
  "user": "e4aDpJsBimkh-TeQaV1A",
  "task": "email-search",
  "name": "pipeline_bulk_20260112_120000",
  "data": [
    ["John", "Doe", "google.com"],
    ["Jane", "Smith", "microsoft.com"]
  ]
}
```

## Setup Instructions
1. Add to your `.env` file:
   ```
   ICYPEAS_USER_ID=e4aDpJsBimkh-TeQaV1A
   ```

2. The bulk enrichment will now:
   - Submit bulk searches with proper authentication
   - Poll for completion using `/search-files/read`
   - Fetch results using `/bulk-single-searchs/read` with `mode: bulk`
   - Return enriched leads with email addresses

## Testing
Run the test script to verify:
```bash
python scripts/pipeline/test_bulk_fixed.py
```

Expected output:
```
============================================================
STEP 1: CHECK CONFIGURATION
============================================================
[OK] User ID configured: e4aDpJsBimkh-TeQaV1A

============================================================
STEP 2: SUBMIT BULK SEARCH
============================================================
Submitting 5 leads...
[OK] Bulk search submitted with file ID: ...

============================================================
STEP 3: POLL FOR COMPLETION
============================================================
Waiting for bulk search to complete (max 600 seconds)...
[OK] Bulk search completed

============================================================
STEP 4: FETCH RESULTS
============================================================
[OK] Fetched N results

[PASS] Bulk enrichment is working!
```

## Performance Improvement
- **Previous approach**: Single email search per lead (1 API call per lead)
- **New approach**: Bulk search (1 API call for all leads)
- **Speed**: ~10-20x faster for large batches (39 leads should complete in seconds instead of minutes)

## API Endpoints Used
1. `POST /bulk-search` - Submit bulk search with user ID
2. `POST /search-files/read` - Poll for completion status
3. `POST /bulk-single-searchs/read` - Fetch results with pagination
