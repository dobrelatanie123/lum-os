/**
 * Author Normalization
 * Fuzzy matching for researcher names commonly mentioned in podcasts
 */

import type { NormalizedAuthor, KnownResearcher } from './types.js';

// Known researchers frequently mentioned in health/fitness/science podcasts
export const KNOWN_RESEARCHERS: Record<string, KnownResearcher> = {
  'candow': { 
    full_name: 'Darren Candow', 
    variants: ['Kandow', 'Candow', 'Cando'],
    institution: 'University of Regina'
  },
  'huberman': { 
    full_name: 'Andrew Huberman', 
    variants: ['Hubermann', 'Huberman'],
    institution: 'Stanford'
  },
  'attia': { 
    full_name: 'Peter Attia', 
    variants: ['Atia', 'Attia'] 
  },
  'antonio': { 
    full_name: 'Jose Antonio', 
    variants: ['Joey Antonio', 'Jose Antonio', 'J Antonio'] 
  },
  'krieger': { 
    full_name: 'James Krieger', 
    variants: ['Krieger', 'Kreiger'] 
  },
  'schoenfeld': { 
    full_name: 'Brad Schoenfeld', 
    variants: ['Schoenfeld', 'Shoenfeld'] 
  },
  'trexler': { 
    full_name: 'Eric Trexler', 
    variants: ['Trexler', 'Treksler'] 
  },
  'barakat': { 
    full_name: 'Chris Barakat', 
    variants: ['Barakat'] 
  },
  'norton': { 
    full_name: 'Layne Norton', 
    variants: ['Layman', 'Layne', 'Norton'] 
  },
  'helms': { 
    full_name: 'Eric Helms', 
    variants: ['Helms'] 
  },
  'morton': { 
    full_name: 'Robert Morton', 
    variants: ['Morton'] 
  },
  'pelland': { 
    full_name: 'Pelland', 
    variants: ['Pelland'] 
  },
  'bickel': { 
    full_name: 'Bickel', 
    variants: ['Bickel'] 
  },
  'bray': { 
    full_name: 'George Bray', 
    variants: ['Bray'] 
  },
  'chavez': { 
    full_name: 'Chavez', 
    variants: ['Chavez'] 
  },
};

/**
 * Normalize author name with fuzzy matching
 */
export function normalizeAuthor(mentioned: string | null): NormalizedAuthor {
  if (!mentioned) {
    return { normalized: null, variants: [] };
  }
  
  // Extract surname (remove Dr./Professor prefix)
  const cleaned = mentioned.replace(/^(Dr\.?|Professor)\s*/i, '').trim();
  const parts = cleaned.split(' ');
  const surname = parts[parts.length - 1].toLowerCase();
  
  // Check known researchers
  for (const [key, data] of Object.entries(KNOWN_RESEARCHERS)) {
    const allVariants = [key, ...data.variants.map(v => v.toLowerCase())];
    if (allVariants.includes(surname)) {
      return {
        normalized: data.full_name,
        variants: data.variants
      };
    }
  }
  
  // Unknown researcher - generate phonetic variants
  return {
    normalized: mentioned,
    variants: generatePhoneticVariants(surname)
  };
}

/**
 * Generate phonetic variants for unknown author names
 */
export function generatePhoneticVariants(name: string): string[] {
  const variants = new Set([name]);
  
  // K/C swap at start
  if (name.startsWith('k')) variants.add('c' + name.slice(1));
  if (name.startsWith('c')) variants.add('k' + name.slice(1));
  
  // Double letter variations
  variants.add(name.replace(/(.)\1/g, '$1'));
  
  // -er/-or endings
  if (name.endsWith('er')) variants.add(name.slice(0, -2) + 'or');
  if (name.endsWith('or')) variants.add(name.slice(0, -2) + 'er');
  
  // -man/-mann endings
  if (name.endsWith('mann')) variants.add(name.slice(0, -1));
  if (name.endsWith('man')) variants.add(name + 'n');
  
  // -son/-sen endings
  if (name.endsWith('son')) variants.add(name.slice(0, -2) + 'en');
  if (name.endsWith('sen')) variants.add(name.slice(0, -2) + 'on');
  
  return [...variants];
}

