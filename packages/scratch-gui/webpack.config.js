const path = require('path');
const webpack = require('webpack');

// Plugins
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const WorkboxPlugin = require('workbox-webpack-plugin');
const WebpackPwaManifest = require('webpack-pwa-manifest');

const ScratchWebpackConfigBuilder = require('scratch-webpack-configuration');

// const STATIC_PATH = process.env.STATIC_PATH || '/static';

const commonHtmlWebpackPluginOptions = {
    // Google Tag Manager ID
    // Looks like 'GTM-XXXXXXX'
    gtm_id: process.env.GTM_ID || '',

    // Google Tag Manager env & auth info for alterative GTM environments
    // Looks like '&gtm_auth=0123456789abcdefghijklm&gtm_preview=env-00&gtm_cookies_win=x'
    // Taken from the middle of: GTM -> Admin -> Environments -> (environment) -> Get Snippet
    // Blank for production
    gtm_env_auth: process.env.GTM_ENV_AUTH || ''
};

const cssModuleExceptions = [
    /\.raw\.css$/, // Allow for overriding CSS classes from libraries
    /[\\/]driver\.js[\\/].*\.css$/ // driver.js CSS
];

const baseConfig = new ScratchWebpackConfigBuilder(
    {
        rootPath: path.resolve(__dirname),
        enableReact: true,
        enableTs: true,
        shouldSplitChunks: false,
        cssModuleExceptions
    })
    .setTarget('browserslist')
    .merge({
        output: {
            assetModuleFilename: 'static/assets/[name].[hash][ext][query]',
            library: {
                name: 'GUI',
                type: 'umd2'
            },
            // Do not clean the JS files before building as we have two outputs to the same
            // dist directory (the regular and the standalone version)
            clean: false
        },
        resolve: {
            fallback: {
                Buffer: require.resolve('buffer/'),
                stream: require.resolve('stream-browserify')
            }
        }
    })
    .addModuleRule({
        test: /\.(svg|png|wav|mp3|gif|jpg)$/,
        resourceQuery: /^$/, // reject any query string
        type: 'asset' // let webpack decide on the best type of asset
    })
    .addPlugin(new webpack.DefinePlugin({
        'process.env.DEBUG': Boolean(process.env.DEBUG),
        'process.env.GA_ID': `"${process.env.GA_ID || 'UA-000000-01'}"`,
        'process.env.GTM_ENV_AUTH': `"${process.env.GTM_ENV_AUTH || ''}"`,
        'process.env.GTM_ID': process.env.GTM_ID ? `"${process.env.GTM_ID}"` : null
    }))
    .addPlugin(new CopyWebpackPlugin({
        patterns: [
            {
                from: '../../node_modules/scratch-blocks/media',
                to: 'static/blocks-media/default'
            },
            {
                from: '../../node_modules/scratch-blocks/media',
                to: 'static/blocks-media/high-contrast'
            },
            {
                // overwrite some of the default block media with high-contrast versions
                // this entry must come after copying scratch-blocks/media into the high-contrast directory
                from: 'src/lib/settings/color-mode/high-contrast/blocks-media',
                to: 'static/blocks-media/high-contrast',
                force: true
            },
            {
                context: '../../node_modules/@scratch/scratch-vm/dist/web',
                from: 'extension-worker.{js,js.map}',
                noErrorOnMissing: true
            },
            {
                context: '../../node_modules/scratch-storage/dist/web',
                from: 'chunks/fetch-worker.*.{js,js.map}',
                noErrorOnMissing: true
            },
            {
                context: '../../node_modules/scratch-storage/dist/web',
                from: 'chunks/vendors-*.{js,js.map}',
                noErrorOnMissing: true
            },
            {
                from: '../../node_modules/@mediapipe/face_detection',
                to: 'chunks/mediapipe/face_detection'
            }
        ]
    }));

// Add Workbox plugin for service worker generation
if (process.env.NODE_ENV === 'development') {
    console.log('Skipping Workbox plugin for service worker generation');
} else {
    // eslint-disable-next-line global-require
    const assetsManifest = require('./src/assetsManifest.json');
    console.log('Adding Workbox plugin for service worker generation');
    baseConfig
        .addPlugin(new WorkboxPlugin.GenerateSW({
            clientsClaim: true,
            skipWaiting: true,
            additionalManifestEntries: assetsManifest,
            exclude: [
                /\.DS_Store/,
                /\.html$/,
                /\.d\.ts$/, // Exclude TypeScript declaration files
                /\.map$/, // Exclude source maps from precache
                /^\.\.\// // Exclude assets in parent directories (like ../dist/)
            ],
            maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
            runtimeCaching: [{
                // Apply NetworkFirst strategy to HTML and navigation requests (e.g. /editor/, /editor/?extension=...)
                // Online: always fetch the latest from the network; Offline: fall back to cache
                urlPattern: ({request}) => request.mode === 'navigate',
                handler: 'NetworkFirst',
                options: {
                    cacheName: 'pages-cache',
                    networkTimeoutSeconds: 3,
                    fetchOptions: {
                        cache: 'reload'
                    }
                }
            }]
        }))
        .addPlugin(new WebpackPwaManifest({
            publicPath: './',
            name: 'Xcratch',
            short_name: 'Xcratch',
            description: 'Extendable Scratch3 mod',
            background_color: '#ffffff',
            orientation: 'any',
            crossorigin: 'use-credentials',
            inject: true,
            ios: {
                'apple-mobile-web-app-title': 'Xcratch',
                'apple-mobile-web-app-status-bar-style': 'default'
            },
            icons: [
                {
                    src: path.resolve('static/pwa-icon.png'),
                    sizes: [96, 128, 192, 256, 384, 512] // multiple sizes
                },
                {
                    src: path.resolve('static/pwa-maskable_icon.png'),
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable'
                }
            ]
        }));
}

if (!process.env.CI) {
    baseConfig.addPlugin(new webpack.ProgressPlugin());
}

// build the shipping library in `dist/`
const distConfig = baseConfig.clone()
    .merge({
        entry: {
            'scratch-gui': path.join(__dirname, 'src/index.ts')
        },
        output: {
            // We need the public path to be relative, because of scratch-desktop and scratch-android
            // - if the publicPath is static here (defaults to `/`), they are unable to load their assets,
            // which depend on a relative path resolution.
            // (e.g. `/tmp/*path-to-packaged-dist*/static/assets` in scratch-desktop)
            publicPath: 'auto',
            path: path.resolve(__dirname, 'dist')
        }
    })
    .addExternals(['react', 'react-dom', 'redux', 'react-redux'])
    .addPlugin(
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: 'src/lib/libraries/*.json',
                    to: 'libraries',
                    flatten: true
                }
            ]
        })
    );

// build the shipping library in `dist/` bundled with react, react-dom, redux, etc.
const distStandaloneConfig = baseConfig.clone()
    .merge({
        entry: {
            'scratch-gui-standalone': path.join(__dirname, 'src/index-standalone.tsx')
        },
        output: {
            path: path.resolve(__dirname, 'dist')
        }
    });

// build the examples and debugging tools in `build/`
const buildConfig = baseConfig.clone()
    .enableDevServer(process.env.PORT || 8601)
    .merge({
        entry: {
            gui: './src/playground/index.jsx',
            guistandalone: './src/playground/standalone.jsx',
            blocksonly: './src/playground/blocks-only.jsx',
            compatibilitytesting: './src/playground/compatibility-testing.jsx',
            player: './src/playground/player.jsx'
        },
        output: {
            path: path.resolve(__dirname, 'build'),

            // This output is loaded using a file:// scheme from the local file system.
            // Having `publicPath: '/'` (the default) means the `gui.js` file in `build/index.html`
            // would be looked for at the root of the filesystem, which is incorrect.
            // Use 'auto' to let webpack determine the publicPath automatically based on the
            // current location (document.currentScript or import.meta.url), which properly
            // handles both HTTP and file:// protocols for loading chunks and web workers.
            publicPath: 'auto'
        }
    })
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['gui'],
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['guistandalone'],
        filename: 'standalone.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Standalone Mode'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['blocksonly'],
        filename: 'blocks-only.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Blocks Only Example'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['compatibilitytesting'],
        filename: 'compatibility-testing.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Compatibility Testing'
    }))
    .addPlugin(new HtmlWebpackPlugin({
        ...commonHtmlWebpackPluginOptions,
        chunks: ['player'],
        filename: 'player.html',
        template: 'src/playground/index.ejs',
        title: 'Scratch 3.0 GUI: Player Example'
    }))
    .addPlugin(new CopyWebpackPlugin({
        patterns: [
            {
                from: 'static',
                to: 'static'
            },
            {
                from: 'extensions/**',
                to: 'static',
                context: 'src/examples'
            }
        ]
    }));

// Enable HTTPS for the dev server
buildConfig.merge({
    devServer: {
        historyApiFallback: true,
        server: {
            type: 'https',
            options: {
                key: '../../.vscode/localhost-key.pem',
                cert: '../../.vscode/localhost.pem'
            }
        }
    }
});

// Skip building `dist/` unless explicitly requested
// It roughly doubles build time and isn't needed for `scratch-gui` development
// If you need non-production `dist/` for local dev, such as for `scratch-www` work, you can run something like:
// `BUILD_MODE=dist npm run build`
const buildDist = process.env.NODE_ENV === 'production' || process.env.BUILD_MODE === 'dist';

let config;
switch (process.env.BUILD_TYPE) {
case 'dist': config = distConfig.get(); break;
case 'dist-standalone': config = distStandaloneConfig.get(); break;
default: config = buildConfig.get(); break;
}

module.exports = buildDist ? config : buildConfig.get();
