# GitHub Productivity Dashboard 📊

A Chrome extension that tracks your GitHub activity and provides insights into your coding patterns. Simple, clean, and focused on helping you understand your development habits.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![GitHub API](https://img.shields.io/badge/GitHub-API-181717?logo=github&logoColor=white)

## Features ✨

### 📈 Activity Tracking
- **Contribution metrics** - Track your GitHub contributions over 7, 14, or 30 days
- **Visual trend chart** - See your activity patterns at a glance
- **Best day tracking** - Identify your most productive coding sessions

### 🏆 Developer Reputation Score
A comprehensive scoring system (0-1000) that evaluates:
- **Consistency** - How regularly you contribute
- **Velocity** - Your daily contribution rate
- **Quality** - Balanced commit patterns
- **Collaboration** - Language diversity and engagement
- **Impact** - Streak longevity and total volume

**Tier System:**
- 🌟 Elite (850-1000)
- ⭐ Excellent (700-849)
- ✨ Very Good (550-699)
- 💫 Good (400-549)
- 🌱 Fair (250-399)
- 🌟 Developing (0-249)

### 🎯 Goal Tracking
- Set weekly contribution goals
- Visual progress bars
- Per-user goal persistence
- Achievement celebrations

### 🎨 Activity Patterns
Understand your coding style:
- **Coding Rhythm** - Power Coder, Consistent Builder, Regular Contributor, etc.
- **Streak Style** - Marathon Runner, Week Warrior, Sprint Starter, etc.
- **Most Productive Day** - See when you're at your best

### 📚 Recent Profiles
- Quick access to recently analyzed profiles
- One-click re-analysis
- Stores up to 20 profiles locally

### ⚙️ Smart Features
- **Intelligent caching** - 15-minute cache to respect API limits
- **GraphQL + REST API** - Uses GraphQL when token available, falls back to Events API
- **Rate limit awareness** - Shows remaining API calls
- **Dark mode support** - Automatically adapts to system preferences

## Installation 🚀

### From Chrome Web Store
*Coming soon...*

### Manual Installation (Development)

1. **Clone the repository**
   ```bash
   git clone https://github.com/Aashir-G/github-dashboard.git
   cd github-dashboard
   ```

2. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the extension directory

3. **Optional: Add GitHub Token**
   - Generate a token at [GitHub Settings > Personal Access Tokens](https://github.com/settings/tokens)
   - No special scopes needed for public data
   - Add token in extension settings for higher rate limits (5,000/hr vs 60/hr)

## Usage 💡

### Analyze Any GitHub Profile

**Method 1: On GitHub**
1. Navigate to any GitHub profile
2. Click the extension icon
3. Click "Analyze profile"

**Method 2: Manual Entry**
1. Click the extension icon
2. Enter username in the input field
3. Click "Go"

### Switch Time Ranges
Click the time period buttons (7d, 14d, 30d) to change the analysis window.

### Set Goals
1. Analyze a profile
2. Scroll to "Goal Tracking"
3. Enter your target contributions
4. Click "Set"

### View Recent Profiles
1. Click "Recent profiles" at the top
2. Click any profile to re-analyze

## File Structure 📁

```
github-dashboard/
├── manifest.json          # Extension configuration
├── sidepanel.html         # Main UI
├── sidepanel.css          # Styling
├── sidepanel.js           # UI logic & scoring
├── sw.js                  # Service worker (data fetching)
├── api.js                 # GitHub API utilities
└── README.md             # This file
```

## API Rate Limits 🚦

| Auth Type | Rate Limit | Recommended For |
|-----------|------------|-----------------|
| No Token | 60/hour | Casual use |
| With Token | 5,000/hour | Regular use |

The extension uses smart caching (15-minute TTL) to minimize API calls.

## Technologies Used 🛠️

- **Chrome Extension APIs** - Side panel, storage, messaging
- **GitHub GraphQL API** - Primary data source (when authenticated)
- **GitHub REST API** - Fallback for unauthenticated requests
- **Vanilla JavaScript** - No frameworks, pure performance
- **CSS Grid/Flexbox** - Responsive layouts

## Scoring Algorithm 📐

The reputation score is calculated from 5 factors (each 0-200 points):

### Consistency (0-200)
```
points = min(200, consistency% × 2.5)
```

### Velocity (0-200)
Scaled ranges:
- 10+ commits/day → 200 points
- 5-10 commits/day → 120-200 points
- 2-5 commits/day → 48-120 points
- 0-2 commits/day → 0-48 points

### Quality (0-200)
Based on commits per active day:
- 8-20 commits/day → 200 points
- 5-25 commits/day → 185 points
- 3-30 commits/day → 170 points
- 2+ commits/day → 155 points

### Collaboration (0-200)
```
points = min(200, consistency × 1.2 + languages × 18)
```

### Impact (0-200)
```
streakScore = min(100, bestStreak × 10)
volumeScore = min(100, totalContributions × 2)
points = min(200, streakScore + volumeScore)
```

**Total Score** = Sum of all 5 factors (max 1000)

## Privacy 🔒

- **All data stored locally** in Chrome storage
- **No external servers** - direct GitHub API communication only
- **Your token never leaves your browser**
- **No tracking or analytics**

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup
```bash
# Clone the repo
git clone https://github.com/Aashir-G/github-dashboard.git

# Make changes
# Test by loading unpacked extension in Chrome

# Submit PR
```

## Known Limitations ⚠️

- Only tracks public GitHub activity
- Events API limited to last ~300 events
- Cannot access private repositories without additional permissions
- Contribution counts may differ from GitHub's native UI (different counting methods)

## Future Ideas 💭

- [ ] Weekly email summaries
- [ ] Compare multiple users side-by-side
- [ ] Organization-wide analytics
- [ ] Contribution heatmap calendar view
- [ ] Export data to CSV/JSON
- [ ] Custom scoring weights
- [ ] Integration with other Git platforms (GitLab, Bitbucket)

## License 📄

MIT License - feel free to use this project however you'd like!

## Support 💬

Found a bug? Have a feature request? 
- Open an issue on GitHub
- Or submit a PR!

## Acknowledgments 🙏

Built with ❤️ for the GitHub developer community.

---

**Made for GitHub** | Track smarter, code better 🚀