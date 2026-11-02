var ZotMeta;

function log(msg) {
    Zotero.debug("ZotMeta: " + msg);
}

function install() {
    log("Installed");
}

async function configurePrivateBuildUpdates(id) {
    // Zotero requires update_url even for a private build. Only the packaged
    // private prefs enable this; ordinary upstream builds keep their policy.
    if (!Services.prefs.getBoolPref('extensions.zotmeta.privateBuild', false)) return;
    var { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    var addon = await AddonManager.getAddonByID(id);
    if (!addon) throw new Error('ZotMeta private build could not resolve its add-on ID');
    addon.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DISABLE;
}

async function startup({ id, version, rootURI }) {
    log("Starting");
    await configurePrivateBuildUpdates(id);

    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/l10n.js');
    ZotMetaL10n.init(rootURI);

    if (Zotero.PreferencePanes && typeof Zotero.PreferencePanes.register === 'function') {
        await Zotero.PreferencePanes.register({
            pluginID: id,
            id: 'zotmeta-prefpane',
            label: 'ZotMeta',
            src: rootURI + 'preferences.xhtml',
            scripts: [rootURI + 'chrome/content/l10n.js', rootURI + 'preferences.js'],
            stylesheets: [rootURI + 'theme.css']
        });
    }
    
    // Load chrome/content file directly via file:/// URL
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/utilities.js');
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/threadpool.js');
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/pubmed.js');
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/journal.js');
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/book.js');
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/arxiv.js');
    Services.scriptloader.loadSubScript(rootURI + 'chrome/content/zotmeta.js');
    ZotMeta.init({ id, version, rootURI });
    ZotMeta.addToAllWindows();
}

function onMainWindowLoad({ window }) {
    ZotMeta.addToWindow(window);
}

function onMainWindowUnload({ window }) {
    ZotMeta.removeFromWindow(window);
}

function shutdown() {
    log("Shutting down");
    ZotMeta.removeFromAllWindows();
}

function uninstall() {
    log("Uninstalled");
}
