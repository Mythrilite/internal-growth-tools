# Clado Enrichment Flow - Twitter Verifier & LinkedIn Enricher

## Overview

Clado is an email enrichment API that takes LinkedIn URLs and returns contact information (emails, phone numbers) for users. The flow in this app works in two stages:

1. **ICP Filtering** - Use AI to filter leads that match your ideal customer profile
2. **Contact Enrichment** - Use Clado API to fetch email and phone data for filtered leads

---

## How Clado Enrichment Works

### Step 1: API Authentication
```
Clado API Key → Bearer Token Authorization
Endpoint: https://search.clado.ai/api/enrich/contacts
```

### Step 2: Request Format
```typescript
POST https://search.clado.ai/api/enrich/contacts
Headers: {
  Authorization: Bearer {CLADO_API_KEY}
}
Query Params:
  linkedin_url: "https://www.linkedin.com/in/username"
  email_enrichment: true
```

### Step 3: Response Structure
Clado returns contact data in this format:

```json
{
  "data": [
    {
      "contacts": [
        {
          "type": "email",
          "value": "john.doe@company.com",
          "subType": "professional",
          "rating": 0.95,
          "label": "work"
        },
        {
          "type": "phone",
          "value": "+1-555-0123",
          "rating": 0.85
        }
      ]
    }
  ]
}
```

---

## Current Implementation in LinkedIn Enricher

### Full Flow:

1. **Fetch Reactions** → Get LinkedIn profiles from post reactions
2. **Filter by ICP** → AI analyzes profiles against your criteria
3. **Enrich with Clado** → Fetch emails/phones for accepted leads

### Code Flow (LinkedIn Enricher):

```
User Input: LinkedIn Post URL
           ↓
    [POST /api/linkedin-enricher]
           ↓
    STAGE 1: Fetch Reactions (20 at a time)
           ↓
    STAGE 2: Filter by ICP (AI verification in batches)
           ↓
    Accepted Leads → User clicks "Enrich with Emails"
           ↓
    [PATCH /api/linkedin-enricher with provider='clado']
           ↓
    STAGE 3: Contact Enrichment (5 leads at a time)
           ↓
    enrichContact(linkedin_url, clado_api_key)
           ↓
    Response: { email, phone, rating, company_domain }
```

### Enrichment Function Details

**File**: `/lib/linkedin-enricher.ts` → `enrichContact()`

```typescript
export async function enrichContact(
  linkedinUrl: string,
  apiKey: string
): Promise<ContactData>
```

**What it does:**
1. Formats LinkedIn URL properly
2. Calls Clado API with LinkedIn URL
3. Parses response to extract emails
4. Filters out personal email domains (gmail, yahoo, etc.)
5. Selects best email by:
   - Confidence rating (highest first)
   - Subtype (professional > personal)
   - Returns rating score for user reference

**Returns:**
```typescript
interface ContactData {
  email?: string;           // Best email found
  email_rating?: number;    // Confidence 0-1
  email_subtype?: string;   // "professional" or "personal"
  phone?: string;           // Phone number if found
  phone_rating?: number;    // Confidence 0-1
  company_domain?: string;  // Extracted from email domain
}
```

---

## Batch Processing Strategy

### API Rate Limiting
- **Enrichment batch size**: 5 leads per batch
- **Delay between batches**: 200ms
- **Parallel processing**: Up to 4 batches in parallel

### Why Batching?
- Respects Clado's rate limits
- Prevents timeouts on large lists
- Allows progress tracking for UI

### Example:
```
100 leads total
↓
Split into batches of 5 (20 batches total)
↓
Process 4 batches in parallel (Promise.all)
↓
Wait 200ms
↓
Process next 4 batches
↓
Continue until all done
```

---

## Data Flow in LinkedIn Enricher Page

### State Management:
```typescript
const [enrichmentProvider, setEnrichmentProvider] = useState<'clado' | 'apollo'>('clado');

// When enriching:
fetch("/api/linkedin-enricher", {
  method: "PATCH",
  body: JSON.stringify({ 
    leads: batch,           // Array of leads to enrich
    provider: 'clado'       // Which enrichment service
  })
})
```

### Results Structure:
```typescript
interface EnrichedLead {
  profile: {
    name: string;
    headline: string;
    linkedin_url: string;
  };
  icp_result: {
    decision: "ACCEPT" | "REJECT";
    confidence: "HIGH" | "MEDIUM" | "LOW";
  };
  contact: {
    email?: string;
    email_rating?: number;
    phone?: string;
    company_domain?: string;
  };
  enrichment_status: "SUCCESS" | "FAILED" | "PENDING";
}
```

---

## Key Features

### ✅ What Clado Provides
- Email addresses with confidence scores
- Phone numbers when available
- Company domain extraction
- Professional vs personal email detection

### ✅ What the App Adds
- Batch processing with rate limiting
- Progress tracking for large datasets
- Error handling and retry logic
- Local storage persistence (resume if interrupted)
- CSV export with enriched contact data

### ✅ Comparison: Clado vs Apollo

| Feature | Clado | Apollo |
|---------|-------|--------|
| **Input** | LinkedIn URL | Profile name/email |
| **API Type** | REST | REST |
| **Batch Size** | 5 per batch | 5 per batch |
| **Email Confidence** | Yes (0-1 rating) | Yes |
| **Phone Numbers** | Yes | Yes |
| **Company Domain** | Extracted | Included |
| **Speed** | Fast | Fast |

---

## Clado-Specific Implementation Details

### Configuration
```env
CLADO_API_KEY=your_clado_api_key_here
```

### Error Handling
The enrichment function handles:
- Invalid LinkedIn URLs (auto-formats)
- API errors (logs and throws)
- Missing email results (returns FAILED status)
- Rate limiting (via batch delays)
- Network timeouts (via error boundaries)

### Success Criteria
A lead is marked "SUCCESS" when:
```javascript
if (contact.email) {
  enrichment_status = "SUCCESS";
} else {
  enrichment_status = "FAILED";
  error = "No email found";
}
```

---

## Cost Optimization

### Staged Approach
1. **Pre-filter** with AI first (cheaper than enriching everyone)
2. **Enrich only qualified leads** (API costs only for good matches)
3. **Batch in small groups** (efficient rate limiting)

### Example Savings
- **Without filtering**: Enrich 1000 leads → ~1000 API calls
- **With filtering**: Enrich 300 qualified leads → ~300 API calls
- **Savings**: 70% API cost reduction

---

## For Twitter Verifier Integration

To add Clado enrichment to the Twitter Verifier:

1. Similar flow but starting from CSV leads instead of LinkedIn reactions
2. Leads accepted by AI verification → Pass to Clado enrichment
3. Use same `enrichContact()` function
4. Add toggle for Clado/Apollo provider selection
5. Batch and export enriched CSV with emails

```typescript
// Pseudo-code for Twitter Verifier enrichment
const acceptedLeads = await verifyWithAI(csvLeads);
const enriched = await enrichWithClado(acceptedLeads);
downloadCSV(enriched);
```
