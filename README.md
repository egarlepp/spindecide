Advanced Picker Wheel — Deployment & Usage Guide

TL;DR Summary (Executive Context)

Zero Data Leakage: Fully client-side architecture guarantees all user entries, custom labels, weights, and session histories are isolated inside the browser's localStorage or offline file systems, meeting enterprise Zero Trust requirements.

VRE Optimization Tool: Designed for high-impact Value Realization Events (VREs). Includes a custom "Spins to Win" score tracking mode, custom banner text/image injection, and Netwrix-branded design styles.

Agile Deployability: Deploys globally in under 2 minutes using standard GitHub Pages, local Nginx configs, or direct Docker/Dokploy orchestration with zero compilation overhead.

🚀 GitHub Pages Setup (The Simplest Web Deploy)

If you want to host this site directly on the web for free using GitHub Pages:

Create a Repository: Go to GitHub and create a new repository (public or private, though public is required for free GitHub Pages).

Add the Code: Upload your index.html file into the root folder of that repository.

Turn on Pages:

Go to the Settings tab of your repository.

On the left sidebar, click Pages.

Under Build and deployment, select Deploy from a branch.

Under Branch, select main (or master) and select / (root). Click Save.

Access your site: Within a minute, GitHub will give you a secure live link (e.g., https://yourusername.github.io/your-repository-name/).

🐳 Dokploy & Docker Deployment Guide

Since this application is a single static file, we can serve it inside an ultra-lightweight web server using Docker and route it through Dokploy.

1. Dockerfile configuration

To prepare your codebase for a Docker build, commit the following two files together in your GitHub repository:

File: Dockerfile

FROM nginx:alpine
# Copy our static build to the server's public container directory
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]


2. Deployment on Dokploy Dashboard

Go to your self-hosted Dokploy panel.

Select or create a Project -> Go to Services -> Click Create Service -> Application.

Link your GitHub account and select the repository holding your files.

Configuration Options:

Set the Build Type to Dockerfile.

Configuring Routing & Custom Ports:

Subdomain Hosting (Recommended via Traefik Proxy): Go to the Domains tab in your Dokploy application config, click Add Domain, and enter your chosen URL (e.g., wheel.yourcompany.com). Traefik will automatically provision SSL and map external traffic directly to the container's internal port 80.

Custom Port Binding (No domain): Go to the Ports tab inside the application panel. Add a mapping:

Host Port: 8080 (or whichever custom port you desire)

Container Port: 80

Click Deploy. Your app is live!

📊 CSV & JSON File Spec Sheets

1. CSV Import Schema (Up to 3 Columns)

The file-uploader automatically reads CSV files line-by-line and appends entries to your active list. Columns must follow this order:
Text, Label (Optional), Weight (Optional)

Example content for participants.csv:

Eric Harris, EH, 1.5
Beatriz Gomez, BG, 1
Charles Peterson,, 2
Diya Patel, DP, 1


Line 3 shows how to skip the optional "Label" column while still declaring a custom slice "Weight" of 2.

2. JSON Backup Schema

The JSON exporter backs up your configuration structure, local browser files, active items, and spin history in one neat bundle:

{
  "savedFiles": {},
  "currentData": {
    "currentListName": "Sales Demo List",
    "settings": {
      "theme": "netwrix",
      "spinDuration": 10,
      "spinsToWin": 3,
      "confettiOn": true,
      "soundOn": true,
      "buttonColor": "#5851DB",
      "bannerType": "text",
      "bannerText": "Netwrix Q2 Jam",
      "storageMethod": "both"
    },
    "items": [
      { "text": "Eric", "color": "#5851DB", "score": 2, "label": "EH", "weight": 1.5, "enabled": true }
    ],
    "history": [
      { "date": "6/9/2026, 11:20:00 AM", "winner": "EH", "listName": "Sales Demo List" }
    ]
  }
}


🛡️ Operational Risks & Mitigations (SE Evaluation)

Cache Clear Data Loss (Medium Risk): Browser local storage can be wiped if users clear their cookies/site data.

Mitigation: Explicitly coach team members to use File -> Save Data which supports automatic offline JSON generation.

Audio Interruption (Low Risk): Modern browsers restrict audio auto-play until an intentional gesture (mouse click, touch tap) has been executed on the document.

Mitigation: Audio activation hooks have been coupled directly to key action handlers (spin(), modal triggers).
