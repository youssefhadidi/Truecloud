#!/bin/bash

# Setup Git hooks
echo "Setting up Git hooks..."

# Make pre-push hook executable
chmod +x .git/hooks/pre-push

echo "✓ Git hooks installed successfully"
echo "The pre-push hook will automatically bump the minor version on each push"
