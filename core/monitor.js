'use strict'

// WEB MONITOR
// Pull only. Web comes IN. Nothing goes OUT.
// Fetches user-approved RSS feeds and URLs → saves as .md in vault
// Vault content never transmitted. GET requests only.

const fs   = require('fs')
const path = require('path')

function today() { return new Date().toISOString().split('T')[0] }

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

async function fetchUrl(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

async function htmlToMd(html) {
  const { NodeHtmlMarkdown } = require('node-html-markdown')
  return NodeHtmlMarkdown.translate(html)
}

async function fetchRss(url) {
  const Parser = require('rss-parser')
  const parser = new Parser()
  return await parser.parseURL(url)
}

// Read approved sources from vault settings
function readMonitorSources(vaultPath) {
  const p = path.join(vaultPath, 'Web Monitor', 'sources.json')
  if (!fs.existsSync(p)) return { feeds: [], urls: [] }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return { feeds: [], urls: [] } }
}

function writeMonitorSources(vaultPath, sources) {
  const dir = path.join(vaultPath, 'Web Monitor')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(sources, null, 2), 'utf8')
}

async function runMonitor(vaultPath) {
  if (!vaultPath) return
  const sources = readMonitorSources(vaultPath)
  const outDir  = path.join(vaultPath, 'Web Monitor', today())
  fs.mkdirSync(outDir, { recursive: true })

  // Process RSS feeds
  for (const feedUrl of (sources.feeds || [])) {
    try {
      const feed = await fetchRss(feedUrl)
      for (const item of (feed.items || []).slice(0, 5)) {
        const slug    = slugify(item.title || 'item')
        const content = `# ${item.title}\nSource: ${feedUrl}\nDate: ${item.pubDate || today()}\nLink: ${item.link}\n\n${item.contentSnippet || item.content || ''}\n`
        fs.writeFileSync(path.join(outDir, `${slug}.md`), content, 'utf8')
      }
    } catch (e) {
      console.error(`Monitor RSS failed for ${feedUrl}:`, e.message)
    }
  }

  // Process plain URLs
  for (const url of (sources.urls || [])) {
    try {
      const html = await fetchUrl(url)
      const md   = await htmlToMd(html)
      const slug = slugify(new URL(url).hostname)
      fs.writeFileSync(path.join(outDir, `${slug}.md`),
        `# ${url}\nFetched: ${today()}\n\n${md.slice(0, 5000)}\n`, 'utf8')
    } catch (e) {
      console.error(`Monitor URL failed for ${url}:`, e.message)
    }
  }
}

function addFeed(vaultPath, url) {
  const sources = readMonitorSources(vaultPath)
  if (!sources.feeds.includes(url)) sources.feeds.push(url)
  writeMonitorSources(vaultPath, sources)
  return `RSS feed added: ${url}`
}

function addUrl(vaultPath, url) {
  const sources = readMonitorSources(vaultPath)
  if (!sources.urls.includes(url)) sources.urls.push(url)
  writeMonitorSources(vaultPath, sources)
  return `URL added to monitor: ${url}`
}

function removeFeed(vaultPath, url) {
  const sources = readMonitorSources(vaultPath)
  sources.feeds = sources.feeds.filter(f => f !== url)
  sources.urls  = sources.urls.filter(u => u !== url)
  writeMonitorSources(vaultPath, sources)
  return `Removed from monitor: ${url}`
}

function getSources(vaultPath) {
  return readMonitorSources(vaultPath)
}

module.exports = { runMonitor, addFeed, addUrl, removeFeed, getSources }
