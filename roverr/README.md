# Roverr - Media Manager Add-on

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-Addon-blue.svg)](https://www.home-assistant.io/)
[![Version](https://img.shields.io/badge/version-4.1.95-green.svg)](https://github.com/datmospro/ha-addons)

**Your personal media manager for Home Assistant.** Automate the organization of downloaded movies from your torrent client to your media server library (Jellyfin, Emby, Kodi, Plex, etc.).

---

## 📸 Screenshots

![Dashboard](https://raw.githubusercontent.com/datmospro/ha-addons/main/roverr/screenshots/dashboard.png)
*Dashboard - Movie Management*

<!-- TODO: Add remaining screenshots
![Movie Details](https://raw.githubusercontent.com/datmospro/ha-addons/main/roverr/screenshots/movie-details.png)
*Movie Details - Full metadata and controls*

![Settings](https://raw.githubusercontent.com/datmospro/ha-addons/main/roverr/screenshots/settings.png)
*Settings - Easy configuration*

![Search](https://raw.githubusercontent.com/datmospro/ha-addons/main/roverr/screenshots/search.png)
*Search - Find and download torrents*
-->

---

## ✨ Features

### Core Functionality
- 🎬 **Automatic Movie Management** - Monitors your torrent client and organizes completed downloads
- 🔍 **Smart Search** - Search multiple indexers (Prowlarr/Jackett) for movies
- 📡 **RSS Integration** - Automated downloads from RSS feeds with size filtering
- 🎯 **TMDB Metadata** - Automatic movie information, posters, and artwork
- 📂 **Intelligent Copying** - Preserves original files for seeding while copying to media library
- 🌐 **Modern Web UI** - Beautiful, responsive dashboard for managing your collection

### Advanced Features
- ⚡ **Auto-Copy on Completion** - Automatically moves completed downloads to your media server
- 🎭 **Multi-Server Support** - Works with Jellyfin, Emby, Kodi, Plex, and other media servers
- 🔄 **Torrent Client Support** - Tested with qBittorrent, works with any client with remote API access
- 📊 **Status Tracking** - Real-time status of downloads, copies, and orphaned files
- 🔔 **Telegram Notifications** - Get notified about new movies, downloads, and transfers
- 🗃️ **Watchlist System** - Monitor movies for wanted quality releases
- 🚫 **Ignore List** - Hide unwanted movies from your dashboard
- 🌍 **Multi-Language Support** - TMDB metadata in your preferred language

### Technical Features
- 🏗️ **Multi-Architecture** - amd64, aarch64, armv7 support
- 💾 **SQLite Database** - Reliable local storage with move history tracking
- 🔒 **Secure** - All credentials stored locally in your Home Assistant instance
- ⚙️ **Configurable** - Extensive settings for customization

---

## 📦 Installation

### Prerequisites
- Home Assistant OS or Supervised installation
- A torrent client (qBittorrent recommended)
- TMDB API key ([Get one free here](https://www.themoviedb.org/settings/api))
- (Optional) Indexer service (Prowlarr or Jackett)
- (Optional) Telegram bot for notifications

### Installation Steps

#### Option 1: Add Repository (Recommended)

1. In Home Assistant, navigate to **Settings → Add-ons → Add-on Store**
2. Click the three dots (⋮) in the top right corner
3. Select **Repositories**
4. Add this repository URL:
   ```
   https://github.com/datmospro/ha-addons
   ```
5. Click **Add** and close the dialog
6. Refresh the page
7. Find **Roverr** in the add-on store and click **Install**

#### Option 2: Manual Installation

1. Connect to your Home Assistant via Samba or SSH
2. Navigate to the `addons` directory
3. Copy the entire `roverr` folder into the `addons` directory
4. Go to **Settings → Add-ons → Add-on Store**
5. Click the three dots (⋮) and select **Check for updates**
6. **Roverr** should appear under "Local Add-ons"
7. Click **Install**

### First Run

1. After installation, **DO NOT START** the add-on yet
2. Go to the **Configuration** tab to change the port if needed
3. Click **Save** and then **Start** the add-on
4. Click **Open Web UI** to access the dashboard
5. Go to **Settings tab** to configure it to your needs

---

## ⚙️ Configuration

### Required Settings

#### Torrent Client
Configure your torrent client connection:

- **Host**: IP address or hostname (e.g., `192.168.1.100`, `localhost`)
- **Port**: Web UI port (default: `8080` for qBittorrent)
- **Username**: Web UI username
- **Password**: Web UI password

#### Paths
Configure where files are located.

> **Note**: Paths must be configured in Home Assistant first.
> Go to **Configuration → System → Storage** (or **Settings → System → Storage**) to set up your media directories.
> After configuring storage in Home Assistant, you can reference those paths here.

- **Source Path**: Directory where your torrent client downloads files
  - Example: `/media/downloads/movies` or `/mnt/media/torrents/movies`
- **Destination Path**: Directory for your media server library
  - Example: `/media/Jellyfin/Movies` or `/mnt/media/Movies`

#### TMDB API
Get movie metadata and artwork:

- **TMDB API Key**: Your API key from [TMDB](https://www.themoviedb.org/settings/api)
- **Language**: Preferred language for metadata (default: `es-ES`)

### Optional Settings

#### Indexers (for Search)
Add Prowlarr or Jackett indexers:

1. Go to **Settings → Indexers**
2. Click **Add New Indexer**
3. Enter:
   - **Name**: Friendly name (e.g., "MyIndexer")
   - **URL**: Indexer base URL (e.g., `http://192.168.1.100:9696`)
   - **API Key**: Your indexer API key
   - **Categories**: Comma-separated categories (e.g., `2000,2010` for movies)
4. Click **Test Connection** to verify
5. Click **Add Indexer**

#### RSS Feeds (for Automation)
Set up automatic downloads:

1. Go to **Settings → RSS Feeds**
2. Click **Add New RSS Feed**
3. Configure:
   - **Name**: Feed identifier
   - **Label**: Category label
   - **RSS URL**: Feed URL
   - **Refresh Interval**: How often to check (seconds)
   - **Auto-add to Dashboard**: Adds movies without downloading
   - **Auto-copy on completion**: Automatically downloads and copies
4. Click **Test Feed** to verify
5. Click **Add Feed**

#### Telegram Notifications
Get notified about your movies:

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your Chat ID via [@userinfobot](https://t.me/userinfobot)
3. Go to **Settings → Notifications**
4. Enter:
   - **Bot Token**: Token from BotFather
   - **Chat ID**: Your Telegram chat ID
5. Choose which events to be notified about:
   - New movie found
   - Download completed
   - Movie moved to library
6. Click **Test Connection**

### Advanced Settings

- **Copy Speed Limit**: Limit transfer speed (MB/s, 0 = unlimited)
- **Auto-copy manual search movies**: Automatically copy manually searched torrents
- **Ignored Movies**: Manage your ignore list
- **Watchlist**: Monitor movies for better quality releases

---

## 🚀 Usage

### Dashboard

The dashboard shows all your movies with real-time status:

- **New** 🆕 - Recently discovered, awaiting download
- **Downloading** ⬇️ - Currently downloading
- **Seeding** 🌱 - Download complete, seeding
- **Copied** ✅ - Successfully copied to media library
- **Orphaned** 🔍 - Torrent removed but file exists

**Actions:**
- Click any movie to view full details
- Use checkboxes to select multiple movies for batch operations
- **Copy Selected** - Copy multiple movies at once
- **Delete Selected** - Remove from torrent client and optionally delete files

### Search

Find and download movies manually:

1. Navigate to **Search** from the sidebar
2. Enter movie title in the search box
3. Click **Search** to query TMDB
4. Click on a movie to see available torrents from your indexers
5. Browse quality options and file sizes
6. Click **Download** to add to your torrent client

The search will automatically:
- Query all configured indexers
- Show file sizes and quality
- Let you choose the best release
- Add it to your torrent client with proper tags

### Settings

Access comprehensive configuration:

- **General**: Paths and basic settings
- **Connection**: Torrent client configuration
- **Indexers**: Manage search providers
- **RSS Feeds**: Automated downloads
- **Notifications**: Telegram bot setup
- **Advanced**: Metadata, performance, ignore list, watchlist

---

## 🔧 Troubleshooting

### Common Issues

#### "Failed to connect to torrent client"
- Verify the IP address and port are correct
- Check that qBittorrent Web UI is enabled
- Ensure username/password are correct
- Test from terminal: `curl http://HOST:PORT`

#### "No torrents found in search"
- Verify indexers are configured correctly
- Test each indexer with the "Test Connection" button
- Check indexer categories (2000, 2010 are typical for movies)
- Ensure indexer service (Prowlarr/Jackett) is running

#### "Movies not copying automatically"
- Check that source and destination paths are correct
- Verify Home Assistant has permission to access both paths
- Ensure "Auto-copy" is enabled in settings
- Check the add-on logs for specific errors

#### "TMDB metadata not loading"
- Verify your TMDB API key is valid
- Check internet connectivity from Home Assistant
- Test the API key at [TMDB API](https://www.themoviedb.org/)

#### "RSS feeds not working"
- Test the RSS URL in a browser first
- Check the refresh interval (minimum 60 seconds)
- Verify the feed format is supported
- Check add-on logs for RSS parsing errors

### Viewing Logs

Access detailed logs for debugging:

1. Go to **Settings → Add-ons → Roverr**
2. Click the **Log** tab
3. Look for error messages in red
4. Increase log verbosity if needed (check add-on configuration)

### Path Configuration Issues

If you're using SMB/Network shares:

- Mount paths must be accessible from within the container
- Use `/mnt/media/...` paths if using the `map: media:rw` configuration
- Ensure SMB credentials are correct
- Test mounting manually first

---

## 🛡️ Security

### Important Security Considerations

⚠️ **This add-on requires access to:**
- Torrent client credentials (username/password)
- TMDB API key
- Indexer API keys
- Telegram bot token (if using notifications)
- File system access (downloads and media library)

**All credentials are stored locally** in `/data/settings.json` within your Home Assistant instance. They are never transmitted outside your network except when making authorized API calls to external services (TMDB, Telegram, indexers).

### Best Practices

- 🔐 Use strong passwords for your torrent client
- 🔑 Keep your TMDB API key private (never commit to repositories)
- 🌐 Consider using HTTPS for external indexers
- 📁 Limit file system access to only necessary directories
- 🔄 Regularly backup your Home Assistant configuration
- 🚫 Never share your `settings.json` file

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Reporting Bugs

1. Check if the issue already exists in [Issues](https://github.com/datmospro/ha-addons/issues)
2. Create a new issue with:
   - Clear description of the problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Relevant logs (remove sensitive information)
   - Your environment (HA version, add-on version)

### Feature Requests

1. Open an issue with the "enhancement" label
2. Describe the feature and its use case
3. Explain why it would be valuable

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

---

## 📋 Roadmap

### Planned Features

- [ ] Support for more torrent clients (Transmission, Deluge)
- [ ] TV show management
- [ ] Better quality upgrade automation
- [ ] Integration with *arr stack (Radarr, Sonarr)
- [ ] Custom quality profiles
- [ ] Import existing media library
- [ ] Multi-user support
- [ ] Mobile app

### Recently Added

- ✅ Watchlist system for monitoring better releases
- ✅ Multi-language metadata support
- ✅ Improved RSS feed handling
- ✅ Batch operations for multiple movies
- ✅ Enhanced status tracking

---

## 📜 License

This project is licensed under the **GNU General Public License v3.0**.

This means:
- ✅ You can use this software for any purpose
- ✅ You can modify the software
- ✅ You can distribute the software
- ✅ You can distribute your modifications
- ⚠️ You must disclose the source code
- ⚠️ You must use the same license (GPL-3.0)
- ⚠️ You must state significant changes

See the [LICENSE](LICENSE) file for full details.

---

## 🙏 Credits & Acknowledgments

### Built With

- [Flask](https://flask.palletsprojects.com/) - Web framework
- [qBittorrent API](https://github.com/rmartin16/qbittorrent-api) - Torrent client integration
- [TMDB API](https://www.themoviedb.org/) - Movie metadata
- [SQLite](https://www.sqlite.org/) - Database

### Special Thanks

- Home Assistant community for support and feedback
- TMDB for providing free movie metadata
- All contributors who have helped improve this project

---

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/datmospro/ha-addons/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/datmospro/ha-addons/discussions)
- 📖 **Documentation**: This README and inline help in settings

---

## ⚖️ Disclaimer

This add-on is a tool for managing your personal media library. The developers are not responsible for:

- How you use this software
- Content you download
- Copyright violations
- Any damages resulting from use of this software

**Use responsibly and respect copyright laws in your jurisdiction.**

---

**Made with ❤️ for the Home Assistant community**
