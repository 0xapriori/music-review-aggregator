# 🚀 Deployment Guide

This guide will help you deploy the Music Review Aggregator to free hosting platforms.

## 📋 Prerequisites

1. **GitHub Account** - For code hosting and GitHub Pages
2. **Railway Account** - For free backend hosting (railway.app)
3. **Git installed** - For version control

## 🗂️ Part 1: GitHub Repository Setup

### 1. Create GitHub Repository
```bash
# Initialize git repository
git init

# Add all files
git add .

# Make initial commit
git commit -m "🎵 Initial commit - Music Review Aggregator"

# Add GitHub remote (replace with your username/repo)
git remote add origin https://github.com/YOUR_USERNAME/music-review-aggregator.git

# Push to GitHub
git push -u origin main
```

### 2. Enable GitHub Pages
1. Go to your repository on GitHub
2. Click **Settings** tab
3. Scroll to **Pages** section
4. Under **Source**, select "GitHub Actions"
5. The workflow will automatically deploy on each push to main

## 🚂 Part 2: Railway Backend Deployment

### 1. Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project"
4. Select "Deploy from GitHub repo"
5. Choose your music-review-aggregator repository

### 2. Configure Railway
1. Railway will auto-detect Node.js
2. Set environment variables:
   - `NODE_ENV=production`
   - `PORT=3001` (Railway will override this)
   - Add any other environment variables from your `.env`

### 3. Get Railway URL
After deployment, Railway will provide a URL like:
`https://music-review-aggregator-production.up.railway.app`

## 🔄 Part 3: Update Frontend Configuration

### 1. Update API URL
Edit `client/src/config.js` and replace the production apiBaseUrl:

```javascript
production: {
  apiBaseUrl: 'https://YOUR_RAILWAY_APP_URL_HERE'
}
```

### 2. Commit and Push
```bash
git add client/src/config.js
git commit -m "🔧 Update API URL for production"
git push origin main
```

This will trigger a new GitHub Pages deployment.

## ✅ Part 4: Verification

### Backend Health Check
```bash
curl https://YOUR_RAILWAY_URL/api/reviews/health
```

### Frontend Access
- Your app will be available at: `https://YOUR_USERNAME.github.io/music-review-aggregator`

## 🛠️ Alternative Deployment Options

### Backend Alternatives
- **Render** (render.com) - Free tier with auto-sleep
- **Heroku** - Free tier discontinued but paid options available
- **Vercel** - Good for serverless functions
- **Glitch** - Free with limitations

### Frontend Alternatives
- **Vercel** - Automatic deployments from GitHub
- **Netlify** - Great CI/CD and form handling
- **GitHub Pages** - Free and reliable (current choice)

## 🔧 Troubleshooting

### GitHub Pages Issues
- Ensure `homepage` field in `client/package.json` matches your repository
- Check GitHub Actions tab for build errors
- Verify the build artifacts are created correctly

### Railway Issues
- Check logs in Railway dashboard
- Ensure all environment variables are set
- Verify health check endpoint is working
- SQLite database will reset on each deployment (normal for free tier)

### CORS Issues
If you encounter CORS errors:
1. Add your GitHub Pages domain to CORS configuration
2. Update `server.js` cors settings:
```javascript
app.use(cors({
  origin: ['https://YOUR_USERNAME.github.io', 'http://localhost:3000']
}));
```

## 📈 Performance Considerations

### Free Tier Limitations
- **Railway**: 500 hours/month, auto-sleep after 5 minutes
- **GitHub Pages**: 100GB bandwidth/month, 1GB storage
- **Database**: SQLite resets on Railway restarts

### Optimization Tips
- Enable caching in production
- Implement service worker for offline functionality
- Use CDN for static assets
- Optimize bundle size with code splitting

## 🔄 Continuous Deployment

The setup automatically handles:
- ✅ Frontend deploys on every push to main
- ✅ Backend deploys on every push to main
- ✅ Health checks ensure deployment success
- ✅ Rollback on deployment failure

## 🎯 Next Steps

1. **Custom Domain**: Configure custom domain for GitHub Pages
2. **Analytics**: Add Google Analytics or similar
3. **Monitoring**: Set up uptime monitoring for Railway
4. **Database**: Consider upgrading to persistent database
5. **CDN**: Implement CloudFlare for global performance

---

**Happy Deploying! 🚀**

Your music review aggregator will be live and accessible to the world!