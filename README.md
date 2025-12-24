# Internal Growth Tools

A collection of internal tools for lead generation and enrichment, built with Next.js, React, and Tailwind CSS.

## Tools

### 1. Twitter Lead Verifier
Upload CSV files of Twitter leads and filter them using a two-stage process:
- **Stage 1**: Fast pre-filtering based on location (US-only), follower count (100-5K), and keyword matching
- **Stage 2**: AI-powered verification using Grok-4.1 to validate against your ICP criteria
- Export qualified leads as CSV

**Features:**
- Handles multi-line Twitter bios correctly (CSV RFC 4180 compliant)
- Parallel batch processing (20 leads at a time)
- Real-time progress tracking
- Detailed rejection reasoning

### 2. LinkedIn Enricher
Extract and enrich leads from LinkedIn post reactions:
- Fetch reactions (likes, comments) from any LinkedIn post
- Filter profiles by ICP criteria using AI
- Enrich qualified leads with email addresses and phone numbers via Clado API
- Export enriched contacts as CSV

**Features:**
- Paginated fetching (handles large posts)
- Rate limiting to respect API limits
- Confidence scores for contact data
- Batch enrichment processing

---

## Setup

### Prerequisites
- Node.js 20+ and npm
- API keys for:
  - [OpenRouter](https://openrouter.ai/) (for AI filtering in both tools)
  - [Clado](https://clado.ai/) (for LinkedIn Enricher only)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Mythrilite/internal-growth-tools.git
   cd internal-growth-tools
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your API keys:
   ```env
   OPENROUTER_API_KEY=your_actual_openrouter_key
   CLADO_API_KEY=your_actual_clado_key
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

4. **Run the development server:**
   ```bash
   npm run dev
   ```

5. **Open your browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

---

## Usage

### Twitter Lead Verifier

1. Go to `/twitter-verifier`
2. Upload a CSV file with at least these columns:
   - `name` - Twitter display name
   - `description` - Twitter bio
   - `location` - User location (optional but recommended)
   - `public_metrics` - JSON string with `followers_count` (optional)
3. Wait for two-stage filtering to complete
4. Download qualified leads CSV

**Example CSV format:**
```csv
name,description,location,public_metrics
John Doe,"Founder @TechCo. Building AI tools for developers.","San Francisco, CA","{""followers_count"": 2500}"
```

### LinkedIn Enricher

1. Go to `/linkedin-enricher`
2. Enter a LinkedIn post URL
3. Wait for reactions to be fetched and filtered by ICP
4. Click "Enrich with Emails" to add contact data
5. Download enriched leads CSV

---

## Development

### Project Structure
```
internal-growth-tools/
├── app/
│   ├── page.tsx                          # Landing page
│   ├── layout.tsx                        # Root layout
│   ├── globals.css                       # Global styles + theme variables
│   ├── twitter-verifier/page.tsx         # Twitter verifier UI
│   ├── linkedin-enricher/page.tsx        # LinkedIn enricher UI
│   └── api/
│       ├── twitter-verifier/route.ts     # Twitter API endpoints
│       └── linkedin-enricher/            # LinkedIn API endpoints
├── lib/
│   ├── twitter-verifier.ts               # Twitter core logic
│   ├── location-filter.ts                # Pre-filtering logic
│   ├── linkedin-enricher.ts              # LinkedIn core logic
│   ├── utils.ts                          # Shared utilities
│   └── __tests__/
│       └── twitter-verifier.test.ts      # Twitter tests
├── components/ui/                        # shadcn/ui components
└── Configuration files (tailwind, tsconfig, etc.)
```

### Running Tests
```bash
npm test          # Run tests with Vitest
npm run test:ui   # Run tests with UI
```

### Building for Production
```bash
npm run build
npm start
```

---

## API Endpoints

### Twitter Verifier
- `POST /api/twitter-verifier` - Parse CSV file
- `PUT /api/twitter-verifier` - Analyze single lead
- `PATCH /api/twitter-verifier` - Batch analyze leads (20 at a time)

### LinkedIn Enricher
- `POST /api/linkedin-enricher` - Fetch and filter reactions
- `PATCH /api/linkedin-enricher` - Enrich leads with contact data
- `POST /api/linkedin-enricher/fetch` - Fetch reactions only
- `POST /api/linkedin-enricher/filter` - Filter by ICP only

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | API key for OpenRouter (Grok-4.1) |
| `CLADO_API_KEY` | Yes (LinkedIn only) | API key for Clado enrichment |
| `NEXT_PUBLIC_APP_URL` | No | App URL (defaults to localhost:3000) |

---

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui (Radix UI primitives)
- **CSV Parsing**: PapaParse (RFC 4180 compliant)
- **Testing**: Vitest
- **AI**: OpenRouter (Grok-4.1-fast model)
- **Enrichment**: Clado API

---

## Notes

### CSV Parsing
The Twitter verifier uses PapaParse for robust CSV parsing that handles:
- Multi-line fields (newlines in Twitter bios)
- Escaped quotes (`""` → `"`)
- Commas within quoted fields
- Dynamic column mapping

Debug logging is enabled to help troubleshoot parsing issues.

### Rate Limiting
- Twitter verifier: 20 leads processed in parallel per batch
- LinkedIn enricher: 500ms delay between page fetches, 200ms between enrichment batches

### Architecture
- Both tools are stateless (no database required)
- Client-side CSV processing for Twitter verifier
- Server-side API calls for LinkedIn enricher
- All AI filtering uses OpenRouter with Grok-4.1-fast

---

## License

MIT

---

## Support

For issues or questions, please open an issue on [GitHub](https://github.com/Mythrilite/internal-growth-tools/issues).
