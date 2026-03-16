#!/bin/bash

echo "Pulling latest code..."
git pull origin main

echo "Restarting PM2 service..."
pm2 restart sales-dashboard

echo "Reloading nginx..."
sudo systemctl reload nginx

echo "Deployment complete."
