import { describe, it, expect } from 'vitest';
import { parseCSV, convertToCSV, type TwitterLead, type FilterResult } from '../twitter-verifier';

describe('parseCSV', () => {
  it('should parse basic CSV with required columns', () => {
    const csv = `name,description
John Doe,Founder at TechCo
Jane Smith,CTO at StartupXYZ`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      name: 'John Doe',
      description: 'Founder at TechCo',
    });
    expect(result[1]).toMatchObject({
      name: 'Jane Smith',
      description: 'CTO at StartupXYZ',
    });
  });

  it('should handle multi-line descriptions (THE BUG FIX)', () => {
    const csv = `name,description,location
"John Doe","Founder at TechCo
Building amazing AI tools
Raised Series A","San Francisco, CA"
"Jane Smith","CTO at StartupXYZ
Former Google engineer","New York, NY"`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].description).toContain('Building amazing AI tools');
    expect(result[0].description).toContain('Raised Series A');
    expect(result[0].location).toBe('San Francisco, CA');
    expect(result[1].description).toContain('Former Google engineer');
  });

  it('should handle escaped quotes in descriptions', () => {
    const csv = `name,description
"John Doe","He said ""hello"" to everyone"
Jane Smith,Regular description`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].description).toContain('"hello"');
  });

  it('should handle commas in quoted fields', () => {
    const csv = `name,description,location
"John Doe","Founder, CEO, and Engineer","San Francisco, CA"`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Founder, CEO, and Engineer');
    expect(result[0].location).toBe('San Francisco, CA');
  });

  it('should handle CSV with location column', () => {
    const csv = `name,description,location
John Doe,Founder at TechCo,San Francisco
Jane Smith,CTO at StartupXYZ,New York`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].location).toBe('San Francisco');
    expect(result[1].location).toBe('New York');
  });

  it('should handle CSV without location column', () => {
    const csv = `name,description
John Doe,Founder at TechCo
Jane Smith,CTO at StartupXYZ`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].location).toBeUndefined();
    expect(result[1].location).toBeUndefined();
  });

  it('should dynamically map extra columns to lead object', () => {
    const csv = `name,description,twitter_handle,followers
John Doe,Founder at TechCo,@johndoe,5000
Jane Smith,CTO at StartupXYZ,@janesmith,3000`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
    expect(result[0].twitter_handle).toBe('@johndoe');
    expect(result[0].followers).toBe('5000');
    expect(result[1].twitter_handle).toBe('@janesmith');
    expect(result[1].followers).toBe('3000');
  });

  it('should skip empty lines', () => {
    const csv = `name,description

John Doe,Founder at TechCo

Jane Smith,CTO at StartupXYZ

`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(2);
  });

  it('should skip rows without name or description', () => {
    const csv = `name,description
John Doe,Founder at TechCo
,Missing name
No description,
,`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
  });

  it('should be case-insensitive for column headers', () => {
    const csv = `NAME,DESCRIPTION,LOCATION
John Doe,Founder at TechCo,San Francisco`;

    const result = parseCSV(csv);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('John Doe');
    expect(result[0].description).toBe('Founder at TechCo');
    expect(result[0].location).toBe('San Francisco');
  });

  it('should throw error if name column is missing', () => {
    const csv = `description,location
Founder at TechCo,San Francisco`;

    expect(() => parseCSV(csv)).toThrow("CSV must have 'name' and 'description' columns");
  });

  it('should throw error if description column is missing', () => {
    const csv = `name,location
John Doe,San Francisco`;

    expect(() => parseCSV(csv)).toThrow("CSV must have 'name' and 'description' columns");
  });

  it('should throw error if CSV has no data rows', () => {
    const csv = `name,description`;

    expect(() => parseCSV(csv)).toThrow("CSV must have at least a header row and one data row");
  });
});

describe('convertToCSV', () => {
  it('should convert leads with filter results to CSV', () => {
    const leads: Array<TwitterLead & { filter_result: FilterResult }> = [
      {
        name: 'John Doe',
        description: 'Founder at TechCo',
        location: 'San Francisco',
        filter_result: {
          decision: 'ACCEPT',
          reasoning: 'Meets all criteria',
          confidence: 'HIGH',
          extracted_info: {
            company: 'TechCo',
            role: 'Founder',
          },
        },
      },
    ];

    const csv = convertToCSV(leads);

    expect(csv).toContain('name');
    expect(csv).toContain('description');
    expect(csv).toContain('decision');
    expect(csv).toContain('reasoning');
    expect(csv).toContain('confidence');
    expect(csv).toContain('John Doe');
    expect(csv).toContain('ACCEPT');
    expect(csv).toContain('HIGH');
  });

  it('should properly quote fields with commas', () => {
    const leads: Array<TwitterLead & { filter_result: FilterResult }> = [
      {
        name: 'John Doe',
        description: 'Founder, CEO, and Engineer',
        filter_result: {
          decision: 'ACCEPT',
          reasoning: 'Good fit, has funding, meets criteria',
          confidence: 'HIGH',
        },
      },
    ];

    const csv = convertToCSV(leads);

    expect(csv).toContain('"Founder, CEO, and Engineer"');
    expect(csv).toContain('"Good fit, has funding, meets criteria"');
  });

  it('should escape quotes in reasoning field', () => {
    const leads: Array<TwitterLead & { filter_result: FilterResult }> = [
      {
        name: 'John Doe',
        description: 'Founder at TechCo',
        filter_result: {
          decision: 'ACCEPT',
          reasoning: 'He said "this is great"',
          confidence: 'HIGH',
        },
      },
    ];

    const csv = convertToCSV(leads);

    // PapaParse escapes quotes as ""
    expect(csv).toContain('He said ""this is great""');
  });

  it('should include all extracted info fields', () => {
    const leads: Array<TwitterLead & { filter_result: FilterResult }> = [
      {
        name: 'John Doe',
        description: 'Founder at TechCo',
        filter_result: {
          decision: 'ACCEPT',
          reasoning: 'Meets criteria',
          confidence: 'HIGH',
          extracted_info: {
            company: 'TechCo',
            role: 'Founder',
            estimated_company_size: '50-100',
            estimated_funding: 'Series A',
            location: 'San Francisco',
          },
        },
      },
    ];

    const csv = convertToCSV(leads);

    expect(csv).toContain('extracted_company');
    expect(csv).toContain('extracted_role');
    expect(csv).toContain('estimated_company_size');
    expect(csv).toContain('estimated_funding');
    expect(csv).toContain('extracted_location');
    expect(csv).toContain('TechCo');
    expect(csv).toContain('Founder');
    expect(csv).toContain('50-100');
    expect(csv).toContain('Series A');
  });

  it('should handle empty extracted_info gracefully', () => {
    const leads: Array<TwitterLead & { filter_result: FilterResult }> = [
      {
        name: 'John Doe',
        description: 'Founder at TechCo',
        filter_result: {
          decision: 'REJECT',
          reasoning: 'Insufficient info',
          confidence: 'LOW',
        },
      },
    ];

    const csv = convertToCSV(leads);

    expect(csv).toContain('extracted_company');
    expect(csv).toContain('REJECT');
  });

  it('should return empty string for empty array', () => {
    const csv = convertToCSV([]);

    expect(csv).toBe('');
  });
});

describe('parseCSV and convertToCSV round-trip', () => {
  it('should preserve data through parse -> convert -> parse cycle', () => {
    const originalCsv = `name,description,location
"John Doe","Founder at TechCo
Building AI tools","San Francisco, CA"
Jane Smith,CTO at StartupXYZ,New York`;

    const parsed = parseCSV(originalCsv);

    // Add filter results for conversion
    const withResults = parsed.map(lead => ({
      ...lead,
      filter_result: {
        decision: 'ACCEPT' as const,
        reasoning: 'Test',
        confidence: 'HIGH' as const,
      },
    }));

    const converted = convertToCSV(withResults);
    const reparsed = parseCSV(converted);

    expect(reparsed).toHaveLength(2);
    expect(reparsed[0].name).toBe('John Doe');
    expect(reparsed[0].description).toContain('Building AI tools');
    expect(reparsed[0].location).toBe('San Francisco, CA');
  });
});
