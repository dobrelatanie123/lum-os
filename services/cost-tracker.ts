import { AI_CONFIG, COST_ESTIMATES } from '../lib/ai-config.js';
import type { CostTrackingInfo } from '../lib/ai-types.js';

/**
 * Cost Tracker Service
 * Monitors and manages API costs for AI services
 */
export class CostTracker {
  private dailyCosts: Map<string, number> = new Map();
  private monthlyCosts: Map<string, number> = new Map();
  private costHistory: Array<{
    service: string;
    cost: number;
    timestamp: Date;
    operation: string;
  }> = [];

  /**
   * Track Whisper API cost
   */
  async trackWhisperCost(duration: number, operation: string = 'transcription'): Promise<number> {
    const cost = COST_ESTIMATES.whisper.costPerChunk(duration);
    await this.addCost('whisper', cost, operation);
    return cost;
  }

  /**
   * Track GPT API cost
   */
  async trackGPTCost(inputTokens: number, outputTokens: number, operation: string = 'fact-check'): Promise<number> {
    const cost = COST_ESTIMATES.gpt.estimateCost(inputTokens, outputTokens);
    await this.addCost('gpt', cost, operation);
    return cost;
  }

  /**
   * Add cost for a service
   */
  private async addCost(service: string, cost: number, operation: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const month = new Date().toISOString().substring(0, 7); // YYYY-MM
    
    // Update daily cost
    const dailyKey = `${service}_${today}`;
    const currentDailyCost = this.dailyCosts.get(dailyKey) || 0;
    const newDailyCost = currentDailyCost + cost;

    // Update monthly cost
    const monthlyKey = `${service}_${month}`;
    const currentMonthlyCost = this.monthlyCosts.get(monthlyKey) || 0;
    const newMonthlyCost = currentMonthlyCost + cost;

    // Check daily cost limit
    if (newDailyCost > AI_CONFIG.limits.costLimit) {
      throw new Error(
        `Daily cost limit exceeded for ${service}: $${newDailyCost.toFixed(2)} (limit: $${AI_CONFIG.limits.costLimit})`
      );
    }

    // Update costs
    this.dailyCosts.set(dailyKey, newDailyCost);
    this.monthlyCosts.set(monthlyKey, newMonthlyCost);

    // Add to history
    this.costHistory.push({
      service,
      cost,
      timestamp: new Date(),
      operation
    });

    // Keep only last 1000 entries in history
    if (this.costHistory.length > 1000) {
      this.costHistory = this.costHistory.slice(-1000);
    }

    console.log(`💰 ${service} cost: $${cost.toFixed(4)} (daily: $${newDailyCost.toFixed(2)}, monthly: $${newMonthlyCost.toFixed(2)})`);
  }

  /**
   * Get daily cost for a service
   */
  getDailyCost(service: string): number {
    const today = new Date().toISOString().split('T')[0];
    const key = `${service}_${today}`;
    return this.dailyCosts.get(key) || 0;
  }

  /**
   * Get monthly cost for a service
   */
  getMonthlyCost(service: string): number {
    const month = new Date().toISOString().substring(0, 7);
    const key = `${service}_${month}`;
    return this.monthlyCosts.get(key) || 0;
  }

  /**
   * Get total daily cost across all services
   */
  getTotalDailyCost(): number {
    const today = new Date().toISOString().split('T')[0];
    let total = 0;
    
    for (const [key, cost] of this.dailyCosts.entries()) {
      if (key.endsWith(`_${today}`)) {
        total += cost;
      }
    }
    
    return total;
  }

  /**
   * Get total monthly cost across all services
   */
  getTotalMonthlyCost(): number {
    const month = new Date().toISOString().substring(0, 7);
    let total = 0;
    
    for (const [key, cost] of this.monthlyCosts.entries()) {
      if (key.endsWith(`_${month}`)) {
        total += cost;
      }
    }
    
    return total;
  }

  /**
   * Get cost tracking information
   */
  getCostTrackingInfo(service: string): CostTrackingInfo {
    const dailyCost = this.getDailyCost(service);
    const monthlyCost = this.getMonthlyCost(service);
    const lastReset = new Date();
    lastReset.setHours(0, 0, 0, 0); // Start of today

    return {
      service,
      dailyCost,
      monthlyCost,
      costLimit: AI_CONFIG.limits.costLimit,
      lastReset
    };
  }

  /**
   * Get cost history for a service
   */
  getCostHistory(service: string, limit: number = 100): Array<{
    cost: number;
    timestamp: Date;
    operation: string;
  }> {
    return this.costHistory
      .filter(entry => entry.service === service)
      .slice(-limit)
      .map(entry => ({
        cost: entry.cost,
        timestamp: entry.timestamp,
        operation: entry.operation
      }));
  }

  /**
   * Get cost summary for the last N days
   */
  getCostSummary(days: number = 7): Array<{
    date: string;
    whisperCost: number;
    gptCost: number;
    totalCost: number;
  }> {
    const summary = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0] || '';
      
      const whisperCost = this.dailyCosts.get(`whisper_${dateStr}`) || 0;
      const gptCost = this.dailyCosts.get(`gpt_${dateStr}`) || 0;
      const totalCost = whisperCost + gptCost;
      
      summary.push({
        date: dateStr,
        whisperCost,
        gptCost,
        totalCost
      });
    }
    
    return summary.reverse(); // Most recent first
  }

  /**
   * Estimate monthly cost based on current usage
   */
  estimateMonthlyCost(): number {
    const currentMonth = new Date().toISOString().substring(0, 7);
    const currentDay = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    
    const currentMonthlyCost = this.getTotalMonthlyCost();
    const estimatedMonthlyCost = (currentMonthlyCost / currentDay) * daysInMonth;
    
    return estimatedMonthlyCost;
  }

  /**
   * Check if cost limit is approaching
   */
  isCostLimitApproaching(threshold: number = 0.8): boolean {
    const dailyCost = this.getTotalDailyCost();
    const limit = AI_CONFIG.limits.costLimit;
    
    return (dailyCost / limit) >= threshold;
  }

  /**
   * Get cost alerts
   */
  getCostAlerts(): string[] {
    const alerts = [];
    const dailyCost = this.getTotalDailyCost();
    const limit = AI_CONFIG.limits.costLimit;
    const percentage = (dailyCost / limit) * 100;
    
    if (percentage >= 90) {
      alerts.push(`🚨 CRITICAL: Daily cost at ${percentage.toFixed(1)}% of limit ($${dailyCost.toFixed(2)}/${limit})`);
    } else if (percentage >= 75) {
      alerts.push(`⚠️ WARNING: Daily cost at ${percentage.toFixed(1)}% of limit ($${dailyCost.toFixed(2)}/${limit})`);
    } else if (percentage >= 50) {
      alerts.push(`ℹ️ INFO: Daily cost at ${percentage.toFixed(1)}% of limit ($${dailyCost.toFixed(2)}/${limit})`);
    }
    
    return alerts;
  }

  /**
   * Reset costs (for testing)
   */
  reset(): void {
    this.dailyCosts.clear();
    this.monthlyCosts.clear();
    this.costHistory = [];
  }

  /**
   * Export cost data for analysis
   */
  exportCostData(): {
    dailyCosts: Record<string, number>;
    monthlyCosts: Record<string, number>;
    costHistory: Array<{
      service: string;
      cost: number;
      timestamp: string;
      operation: string;
    }>;
  } {
    return {
      dailyCosts: Object.fromEntries(this.dailyCosts),
      monthlyCosts: Object.fromEntries(this.monthlyCosts),
      costHistory: this.costHistory.map(entry => ({
        service: entry.service,
        cost: entry.cost,
        timestamp: entry.timestamp.toISOString(),
        operation: entry.operation
      }))
    };
  }
}
