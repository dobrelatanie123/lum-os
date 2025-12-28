/**
 * Full Pipeline Test
 * Tests: Video URL → Claims → Verification
 */

import dotenv from 'dotenv';
dotenv.config();

import { VerificationPipeline } from '../services/claim-extraction/verification-pipeline.js';
import type { SynthesizedClaim } from '../services/claim-extraction/types.js';

// Claims from the Body Recomp video (extracted by Gemini)
const claims: SynthesizedClaim[] = [
  {
    claim_id: 'test_barakat',
    video_id: 'yt-xXVB8A5xvSw',
    segment: { full_text: 'Body recomp studies by Chris Barakat', word_count: 6 },
    extraction: {
      author_mentioned: 'Chris Barakat',
      author_normalized: 'Chris Barakat',
      author_variants: ['Barakat'],
      institution_mentioned: null,
      finding_summary: 'At least 10 studies demonstrate body recomposition phenomenon',
      confidence: 'high' as const
    },
    search: {
      primary_query: 'Barakat body recomposition resistance training review',
      fallback_queries: ['body recomposition lean mass fat loss']
    }
  },
  {
    claim_id: 'test_antonio',
    video_id: 'yt-xXVB8A5xvSw',
    segment: { full_text: 'Jose Antonio protein overfeeding', word_count: 4 },
    extraction: {
      author_mentioned: 'Jose Antonio',
      author_normalized: 'Jose Antonio',
      author_variants: ['Antonio'],
      institution_mentioned: null,
      finding_summary: 'High protein intake leads to no harmful effects',
      confidence: 'high' as const
    },
    search: {
      primary_query: 'Antonio high protein diet no harmful effects resistance trained',
      fallback_queries: ['protein overfeeding body composition']
    }
  },
  {
    claim_id: 'test_bray',
    video_id: 'yt-xXVB8A5xvSw',
    segment: { full_text: 'Bray metabolic ward study', word_count: 4 },
    extraction: {
      author_mentioned: 'George Bray',
      author_normalized: 'George Bray',
      author_variants: ['Bray'],
      institution_mentioned: null,
      finding_summary: 'Protein overfeeding leads to weight gain in metabolic ward',
      confidence: 'high' as const
    },
    search: {
      primary_query: 'Bray dietary protein content weight gain energy expenditure',
      fallback_queries: ['protein overfeeding metabolic ward controlled feeding']
    }
  }
];

async function main() {
  console.log('\n4️⃣ VERIFYING CLAIMS WITH OPENALEX\n');
  console.log('='.repeat(60));
  
  const pipeline = new VerificationPipeline();
  
  for (const claim of claims) {
    console.log(`\n${'─'.repeat(60)}`);
    const verified = await pipeline.verifyClaim(claim);
    
    console.log(`\n📊 Result for ${claim.extraction.author_normalized}:`);
    console.log(`   Verdict: ${verified.verification.result?.verdict}`);
    console.log(`   Confidence: ${verified.verification.result?.confidence}`);
    console.log(`   ${verified.verification.result?.explanation?.slice(0, 100)}...`);
    if (verified.verification.best_paper) {
      console.log(`   📄 Paper: "${verified.verification.best_paper.title.slice(0, 60)}..."`);
      console.log(`   🔗 URL: ${verified.verification.best_paper.url}`);
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ FULL PIPELINE TEST COMPLETE');
}

main().catch(console.error);

