# 🤖 AI Services Setup Guide

This guide will help you set up the AI services for Lumos fact-checking.

## **Prerequisites**

1. **OpenAI API Account**: Sign up at [OpenAI Platform](https://platform.openai.com/)
2. **API Key**: Generate an API key from your OpenAI dashboard
3. **Organization ID** (optional): Get from your OpenAI organization settings

## **Environment Setup**

### **Step 1: Copy Environment Template**
```bash
cp env.example .env
```

### **Step 2: Configure Environment Variables**
Edit `.env` file with your OpenAI credentials:

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-actual-api-key-here
OPENAI_ORGANIZATION=org-your-organization-id-here

# AI Model Configuration
WHISPER_MODEL=whisper-1
GPT_MODEL=gpt-4-turbo-preview

# Audio Processing Limits
MAX_AUDIO_DURATION=300
MAX_FILE_SIZE=25000000

# Rate Limiting
RATE_LIMIT_PER_MINUTE=50
COST_LIMIT_PER_DAY=10.00

# Environment
NODE_ENV=development
```

### **Step 3: Validate Configuration**
```bash
npm run validate-config
```

If successful, you should see:
```
✅ Configuration is valid
```

## **API Key Setup**

### **Getting OpenAI API Key**
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign in or create account
3. Navigate to "API Keys" section
4. Click "Create new secret key"
5. Copy the key (starts with `sk-`)

### **Getting Organization ID (Optional)**
1. In OpenAI Platform, go to "Settings"
2. Find "Organization" section
3. Copy the Organization ID (starts with `org-`)

## **Cost Management**

### **Setting Daily Limits**
- **Development**: $5.00/day (recommended)
- **Testing**: $1.00/day (for initial testing)
- **Production**: $50.00/day (adjust based on usage)

### **Rate Limiting**
- **Development**: 10 requests/minute
- **Production**: 50 requests/minute

## **Testing the Setup**

### **Test Configuration**
```bash
npm run validate-config
```

### **Test API Connection**
```bash
npm run test
```

### **Check Daily Costs**
```bash
npm run check-costs
```

## **Development vs Production**

### **Development Mode**
- Lower rate limits
- Lower cost limits
- Detailed logging
- Mock responses for testing

### **Production Mode**
- Full rate limits
- Higher cost limits
- Optimized logging
- Real AI processing

## **Troubleshooting**

### **Common Issues**

#### **"OPENAI_API_KEY is required"**
- Make sure `.env` file exists
- Check that API key is correctly set
- Verify no extra spaces or quotes

#### **"Rate limit exceeded"**
- Reduce `RATE_LIMIT_PER_MINUTE` in `.env`
- Wait for rate limit to reset
- Check OpenAI usage dashboard

#### **"Cost limit exceeded"**
- Increase `COST_LIMIT_PER_DAY` in `.env`
- Check daily usage in OpenAI dashboard
- Consider optimizing chunk size

### **Debug Mode**
Set `NODE_ENV=development` for detailed logging:
```bash
NODE_ENV=development npm run dev
```

## **Security Notes**

- **Never commit `.env` file** to version control
- **Use environment variables** in production
- **Rotate API keys** regularly
- **Monitor usage** daily

## **Next Steps**

Once environment is set up:
1. Run `npm run dev` to start the server
2. Test with browser extension
3. Monitor costs and performance
4. Adjust limits as needed

## **Support**

If you encounter issues:
1. Check OpenAI service status
2. Verify API key permissions
3. Review rate limit usage
4. Check cost limits

---

*For more details, see the main [AI Integration Plan](./AI_INTEGRATION_PLAN.md)*
