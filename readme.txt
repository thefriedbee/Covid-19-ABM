How to start editing/run project locally:

1. watchify script/main.js -o dist/bundle.js
    This will let you update and bundle js scripts automatically

2. python -m http.server 8000
    This will host a simple local server to test your website


Step 1
Remove the dist directory from the project’s .gitignore file (it’s ignored by default by Yeoman).

Step 2
Make sure git knows about your subtree (the subfolder with your site).

git add dist && git commit -m "Initial dist subtree commit"
Step 3
Use subtree push to send it to the gh-pages branch on GitHub.

git subtree push --prefix dist origin gh-pages
