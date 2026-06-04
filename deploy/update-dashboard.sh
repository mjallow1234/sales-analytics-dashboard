#!/bin/bash
set -e

# Path to the live nginx config file for this site.
# Adjust NGINX_TARGET if your sites-available file uses a different name.
NGINX_TARGET="/etc/nginx/sites-available/analytics"

echo "Pulling latest code..."
git pull origin main

echo "Deploying nginx configuration..."
sudo cp deploy/nginx.analytics.conf "$NGINX_TARGET"

echo "Validating nginx configuration..."
if ! sudo nginx -t; then
    echo "ERROR: nginx configuration test failed. Aborting deployment."
    echo "Nginx was NOT reloaded. The previous live config remains active."
    exit 1
fi

echo "Restarting PM2 service..."
pm2 restart sales-dashboard

echo "Reloading nginx..."
sudo systemctl reload nginx

echo "Deployment complete."
