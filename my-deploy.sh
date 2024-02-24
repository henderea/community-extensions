#!/usr/bin/env bash

echo "npm run bundle"
npm run bundle
name="${1:-$(git rev-parse --abbrev-ref HEAD)}"
echo "sudo rm -rf '/home/henderea/domains/paperback/${name}'"
sudo rm -rf "/home/henderea/domains/paperback/${name}"
echo "sudo cp -r './bundles' '/home/henderea/domains/paperback/${name}'"
sudo cp -r "./bundles" "/home/henderea/domains/paperback/${name}"
echo "sudo chown -R henderea:henderea /home/henderea/domains"
sudo chown -R henderea:henderea "/home/henderea/domains"
