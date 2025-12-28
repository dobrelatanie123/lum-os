/**
 * Test Verification Pipeline
 * Verifies extracted claims against academic papers
 */

import { createClient } from '@supabase/supabase-js';
import { VerificationPipeline } from '../services/claim-extraction/verification-pipeline.js';
import type { SynthesizedClaim } from '../services/claim-extraction/types.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
);

async function loadClaimsFromDB(): Promise<SynthesizedClaim[]> {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('❌ Failed to load claims:', error);
    return [];
  }
  
  // Transform DB format to SynthesizedClaim
  return (data || []).map(row => ({
    claim_id: row.claim_id,
    video_id: row.video_id,
    segment: {
      full_text: row.segment_text,
      word_count: row.segment_word_count
    },
    extraction: {
      author_mentioned: row.author_mentioned,
      author_normalized: row.author_normalized,
      author_variants: row.author_variants || [],
      institution_mentioned: row.institution_mentioned,
      finding_summary: row.finding_summary,
      confidence: row.confidence
    },
    search: {
      primary_query: row.primary_query,
      fallback_queries: row.fallback_queries || []
    }
  }));
}

async function updateClaimVerification(claimId: string, verificationResult: any) {
  const { error } = await supabase
    .from('claims')
    .update({
      verification_status: verificationResult.verdict === 'supported' ? 'verified' :
                          verificationResult.verdict === 'contradicted' ? 'refuted' :
                          'inconclusive',
      verification_result: verificationResult
    })
    .eq('claim_id', claimId);
  
  if (error) {
    console.error(`❌ Failed to update claim ${claimId}:`, error);
  }
}

async function main() {
  console.log('🧪 Verification Pipeline Test\n');
  console.log('='.repeat(60));
  
  // Load claims from database
  const claims = await loadClaimsFromDB();
  console.log(`📚 Loaded ${claims.length} claims from database\n`);
  
  if (claims.length === 0) {
    console.log('No claims to verify. Run test-full-mode.ts first.');
    process.exit(0);
  }
  
  // Test with a subset of high-confidence claims with authors
  const testClaims = claims
    .filter(c => c.extraction.confidence === 'high' && c.extraction.author_normalized)
    .slice(0, 5);  // Test first 5 high-confidence claims
  
  console.log(`🎯 Testing ${testClaims.length} high-confidence claims with named authors\n`);
  
  const pipeline = new VerificationPipeline();
  
  for (const claim of testClaims) {
    console.log(`\n${'─'.repeat(60)}`);
    
    const verified = await pipeline.verifyClaim(claim);
    
    // Save result to database
    if (verified.verification.result) {
      await updateClaimVerification(claim.claim_id, {
        verdict: verified.verification.result.verdict,
        confidence: verified.verification.result.confidence,
        explanation: verified.verification.result.explanation,
        best_paper: verified.verification.best_paper ? {
          title: verified.verification.best_paper.title,
          authors: verified.verification.best_paper.authors,
          year: verified.verification.best_paper.year,
          url: verified.verification.best_paper.url,
          match_score: verified.verification.best_paper.match_score.total_score
        } : null
      });
    }
    
    // Print result
    console.log(`\n   📝 Result:`);
    console.log(`      Verdict: ${verified.verification.result?.verdict}`);
    console.log(`      Confidence: ${verified.verification.result?.confidence}`);
    console.log(`      ${verified.verification.result?.explanation}`);
    if (verified.verification.best_paper) {
      console.log(`      Paper: "${verified.verification.best_paper.title.slice(0, 50)}..."`);
      console.log(`      URL: ${verified.verification.best_paper.url}`);
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 SUMMARY\n');
  
  const { data: verifiedClaims } = await supabase
    .from('claims')
    .select('verification_status')
    .not('verification_status', 'eq', 'pending');
  
  const stats = {
    verified: verifiedClaims?.filter(c => c.verification_status === 'verified').length || 0,
    refuted: verifiedClaims?.filter(c => c.verification_status === 'refuted').length || 0,
    inconclusive: verifiedClaims?.filter(c => c.verification_status === 'inconclusive').length || 0
  };
  
  console.log(`   ✅ Verified (supported): ${stats.verified}`);
  console.log(`   ❌ Refuted (contradicted): ${stats.refuted}`);
  console.log(`   ❓ Inconclusive: ${stats.inconclusive}`);
  console.log('='.repeat(60));
}

main().catch(console.error);

