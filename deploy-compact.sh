#!/bin/bash

echo "🎵 Deploying Music Review Aggregator (Compact Version)"
echo "======================================================"

# Copy necessary files for compact deployment
cp package-compact.json package.json
cp vercel-compact.json vercel.json

echo "✅ Configuration files updated"

# Test the server locally first
echo "🧪 Testing server locally..."
node server-compact.js &
SERVER_PID=$!

# Wait a moment for server to start
sleep 3

# Test endpoints
echo "Testing API endpoints..."

# Test health endpoint
curl -s http://localhost:3001/api/reviews/health | jq .

# Test reviews endpoint  
curl -s "http://localhost:3001/api/reviews/all?limit=3" | jq '.data[0]'

# Test stats endpoint
curl -s http://localhost:3001/api/reviews/stats | jq '.data'

# Kill the test server
kill $SERVER_PID

echo "✅ Local testing completed"

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
npx vercel --prod

echo "✅ Deployment completed!"
echo "Visit your Vercel dashboard to see the live URL"