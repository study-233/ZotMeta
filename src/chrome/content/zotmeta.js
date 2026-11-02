class MetadataFailures extends Set {
    retryable = false;
    rateLimitUntil = Infinity;

    add(message, retryable = true, rateLimitUntil = Infinity) {
        this.retryable ||= retryable;
        this.rateLimitUntil = Math.min(this.rateLimitUntil, rateLimitUntil);
        return super.add(message);
    }
}

ZotMeta = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    addedElementIDs: [],
    updateQueue: [],
    updateActiveCount: 0,
    updateMaxConcurrent: 6,
    updateProgressHandle: null,
    updateBatchCounter: 0,
    updateTotals: null,

    init({ id, version, rootURI } = {}) {
        if (this.initialized) return;
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;
        this.initialized = true;
    },

    log(msg) {
        Zotero.debug("ZotMeta: " + msg);
    },

    addToWindow(window) {
        let doc = window.document;
        if (doc.getElementById('update-metadata')) {
            return;
        }

        // Explicit XUL namespace keeps menu insertion stable in Zotero 7+ chrome windows.
        let XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
        window.MozXULElement.insertFTLIfNeeded("zotmeta.ftl");

        // Add menu option
        let menuitem = doc.createElementNS(XUL_NS, 'menuitem');
        menuitem.id = 'update-metadata';
        menuitem.setAttribute('type', 'button');
        menuitem.setAttribute('label', ZotMetaL10n.t('update-metadata.label'));
        menuitem.addEventListener('command', () => {
            this.updateSelectedItemsMetadata();
        });
        doc.getElementById('zotero-itemmenu').appendChild(menuitem);
        this.storeAddedElement(menuitem);

        let createParentMenuitem = doc.createElementNS(XUL_NS, 'menuitem');
        createParentMenuitem.id = 'zotmeta-create-parent-item';
        createParentMenuitem.setAttribute('type', 'button');
        createParentMenuitem.setAttribute('label', ZotMetaL10n.t('create-parent.label'));
        createParentMenuitem.addEventListener('command', () => {
            this.createParentItemsForSelectedAttachments();
        });
        doc.getElementById('zotero-itemmenu').appendChild(createParentMenuitem);
        this.storeAddedElement(createParentMenuitem);

        this.addToolsMenuItem(window, XUL_NS);

    },

    addToolsMenuItem(window, XUL_NS) {
        let doc = window.document;
        if (doc.getElementById('zotmeta-tools-menuitem')) {
            return;
        }
        let toolsMenu = doc.getElementById('menu_ToolsPopup')
            || doc.getElementById('tools-menu-popup')
            || doc.getElementById('menu-tools-popup');
        if (!toolsMenu) {
            this.log("Tools menu popup not found; ZotMeta control panel menu item was not added.");
            return;
        }

        let separator = doc.createElementNS(XUL_NS, 'menuseparator');
        separator.id = 'zotmeta-tools-separator';
        toolsMenu.appendChild(separator);
        this.storeAddedElement(separator);

        let menuitem = doc.createElementNS(XUL_NS, 'menuitem');
        menuitem.id = 'zotmeta-tools-menuitem';
        menuitem.setAttribute('type', 'button');
        menuitem.setAttribute('label', ZotMetaL10n.t('control-panel.label'));
        menuitem.addEventListener('command', () => {
            this.showControlPanel(window);
        });
        toolsMenu.appendChild(menuitem);
        this.storeAddedElement(menuitem);
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
    },

    storeAddedElement(elem) {
        if (!elem.id) {
            throw new Error("Element must have an id");
        }
        this.addedElementIDs.push(elem.id);
    },

    removeFromWindow(window) {
        var doc = window.document;
        // Remove all elements added to DOM
        for (let id of this.addedElementIDs) {
            let elem = doc.getElementById(id);
            if (elem) elem.remove();
        }
        let fluentLink = doc.querySelector('[href="zotmeta.ftl"]');
        if (fluentLink) {
            fluentLink.remove();
        }
    },

    removeFromAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }
    },

    isArxivPreprint(item) {
        if (item.itemTypeID !== Zotero.ItemTypes.getID('preprint')) {
            return false;
        }
        var repository = item.getField('repository');
        var archiveID = item.getField('archiveID');
        if (repository && repository.toLowerCase().indexOf('arxiv') !== -1) {
            return true;
        }
        if (archiveID && archiveID.toLowerCase().indexOf('arxiv:') === 0) {
            return true;
        }
        return Arxiv.getArxivID(item) !== null;
    },

    getMetadataUpdater(item) {
        if (item.itemTypeID === Zotero.ItemTypes.getID('book')) {
            return Book;
        }
        if (item.itemTypeID === Zotero.ItemTypes.getID('journalArticle')) {
            return Journal;
        }
        if (this.isArxivPreprint(item)) {
            return Arxiv;
        }
        return null;
    },

    getConcurrentThreads() {
        return Utilities.getConcurrentThreads(this.updateMaxConcurrent);
    },

    setConcurrentThreads(value) {
        this.updateMaxConcurrent = Utilities.setConcurrentThreads(value);
        this.fillUpdateQueue();
        return this.updateMaxConcurrent;
    },

    async prepareItemForMetadataUpdate(item) {
        if (!Utilities.isRegularItem(item)) {
            return;
        }
        var isJournalArticle = item.itemTypeID === Zotero.ItemTypes.getID('journalArticle');
        var pubmedIdentifiers = isJournalArticle ? PubMed.getIdentifiers(item) : {};
        var needsDOI = isJournalArticle && !item.getField('DOI') &&
            !(Utilities.getJournalSourceOrder().includes('pubmed') && (pubmedIdentifiers.PMID || pubmedIdentifiers.PMCID));
        var needsArxiv = item.itemTypeID === Zotero.ItemTypes.getID('preprint') && !Arxiv.getArxivID(item);
        if (!needsDOI && !needsArxiv) {
            return;
        }

        var identifiers = await Utilities.extractIdentifiersFromItemAttachments(item);
        if (Utilities.applyIdentifiersToItem(item, identifiers)) {
            await Utilities.saveItemTx(item);
        }
    },

    getActiveWindow(pane = null) {
        if (pane && pane.document && pane.document.defaultView) {
            return pane.document.defaultView;
        }
        if (typeof Zotero.getMainWindow === 'function') {
            return Zotero.getMainWindow();
        }
        return null;
    },

    createUpdateTotals() {
        return {
            total: 0,
            completed: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            failedItems: []
        };
    },

    ensureUpdateProgress(window = null) {
        if (!this.updateProgressHandle) {
            this.updateProgressHandle = Utilities.initializeModernProgress(
                window,
                ZotMetaL10n.t('updating'),
                ZotMetaL10n.t('preparing-updates')
            );
            this.updateTotals = this.createUpdateTotals();
        }
    },

    enqueueUpdateBatch(items, window = null) {
        this.ensureUpdateProgress(window);
        this.updateBatchCounter++;
        var batch = {
            id: this.updateBatchCounter,
            name: ZotMetaL10n.t('batch-name', { number: ZotMetaL10n.number(this.updateBatchCounter) }),
            total: items.length,
            completed: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            failedItems: [],
            progressItem: null
        };
        batch.progressItem = Utilities.addProgressItem(
            this.updateProgressHandle,
            ZotMetaL10n.t('queued-items', { batch: batch.name, items: Utilities.itemCount(batch.total) })
        );

        this.updateTotals.total += items.length;
        for (let item of items) {
            this.updateQueue.push({
                item,
                batch
            });
        }

        this.refreshUpdateProgress();
        this.fillUpdateQueue();
    },

    refreshUpdateProgress() {
        if (!this.updateProgressHandle || !this.updateTotals) {
            return;
        }
        var progress = this.updateTotals.total > 0
            ? Math.round(this.updateTotals.completed / this.updateTotals.total * 100)
            : 0;
        Utilities.publishProgress(
            this.updateProgressHandle,
            progress,
            Utilities.formatBatchProgress(
                this.updateTotals.completed,
                this.updateTotals.total,
                this.updateTotals.success,
                this.updateTotals.failed,
                this.updateTotals.skipped
            ),
            ZotMetaL10n.t('updating')
        );
    },

    refreshUpdateBatch(batch, isFinished = false) {
        var progress = batch.total > 0
            ? Math.round(batch.completed / batch.total * 100)
            : 0;
        Utilities.updateProgressItem(
            batch.progressItem,
            progress,
            Utilities.formatBatchRow(batch.name, batch.completed, batch.total, batch.success, batch.failed, batch.skipped),
            isFinished,
            batch.failed > 0
        );
    },

    fillUpdateQueue() {
        var maxConcurrent = this.getConcurrentThreads();
        while (this.updateActiveCount < maxConcurrent && this.updateQueue.length > 0) {
            var task = this.updateQueue.shift();
            this.updateActiveCount++;
            this.runUpdateTask(task);
        }
    },

    async runUpdateTask(task) {
        try {
            await this.processUpdateTask(task);
        } finally {
            this.updateActiveCount--;
            this.fillUpdateQueue();
            this.finishUpdateQueueIfIdle();
        }
    },

    async processUpdateTask(task) {
        var item = task.item;
        var batch = task.batch;
        var title = Utilities.getItemDisplayTitle(item);
        var status = 1;
        try {
            await this.prepareItemForMetadataUpdate(item);
            var updater = this.getMetadataUpdater(item);
            status = updater ? await this.updateItemWithRetry(updater, item, title, batch) : 2;
        } catch (error) {
            this.logItemFailure(item, title, error, batch.id);
        }
        await this.recordUpdateResult(batch, item, status);
    },

    logItemFailure(item, title, reason, batchID) {
        this.log('Failed to update item metadata: ' + JSON.stringify({ batchID, itemID: item.id, title, reason: String(reason) }));
    },

    async updateItemWithRetry(updater, item, title = Utilities.getItemDisplayTitle(item), batch = {}) {
        var reasons = new MetadataFailures();
        var status = await updater.updateMetadata(item, reasons);
        if (status === 1) {
            var now = Date.now();
            var retryAt = !reasons.size || reasons.retryable ? now + 500 : Infinity;
            if (Number.isFinite(reasons.rateLimitUntil)) {
                batch.cooldownDeadline ??= now + 10000;
                if (Math.max(now, reasons.rateLimitUntil) <= batch.cooldownDeadline) {
                    retryAt = Math.min(retryAt, reasons.rateLimitUntil);
                }
            }
            if (Number.isFinite(retryAt)) {
                await Utilities.delay(Math.max(0, retryAt - now));
                reasons = new MetadataFailures();
                status = await updater.updateMetadata(item, reasons);
            }
        }
        if (status === 1) {
            this.logItemFailure(item, title, [...reasons].join(' | ') || 'Updater returned failure without a diagnostic', batch.id);
        } else if (status === 0 && updater === Arxiv) {
            this.log('Preprint saved: ' + JSON.stringify({ batchID: batch.id, itemID: item.id }));
        }
        return status;
    },

    async recordUpdateResult(batch, item, status) {
        try {
            await Utilities.markItemUpdateStatus(item, status);
        } catch (error) {
            this.log("Failed to update ZotMeta status tag: " + error);
        }

        batch.completed++;
        this.updateTotals.completed++;

        if (status === 0) {
            batch.success++;
            this.updateTotals.success++;
        } else if (status === 2) {
            batch.skipped++;
            this.updateTotals.skipped++;
        } else {
            batch.failed++;
            this.updateTotals.failed++;
            var title = Utilities.getItemDisplayTitle(item);
            batch.failedItems.push(title);
            this.updateTotals.failedItems.push(title);
        }

        this.refreshUpdateBatch(batch, batch.completed === batch.total);
        if (batch.completed === batch.total) {
            this.log('Batch completed: ' + JSON.stringify({
                batchID: batch.id, total: batch.total, updated: batch.success, failed: batch.failed, skipped: batch.skipped
            }));
        }
        this.refreshUpdateProgress();
    },

    finishUpdateQueueIfIdle() {
        if (!this.updateProgressHandle || this.updateActiveCount !== 0 || this.updateQueue.length !== 0) {
            return;
        }

        var totals = this.updateTotals;
        var summary = Utilities.formatBatchSummary(totals.success, totals.failed, totals.skipped, totals.failedItems);
        var title = Utilities.getBatchSummaryTitle(totals.success, totals.failed, totals.skipped);
        Utilities.publishFinishedProgress(this.updateProgressHandle, summary, title, totals.failed > 0);
        this.updateProgressHandle = null;
        this.updateTotals = null;
    },

    async updateSelectedItemsMetadata() {
        var pane = Zotero.getActiveZoteroPane();
        var items = pane.getSelectedItems();
        var window = this.getActiveWindow(pane);
        var itemCount = items.length;
        if (itemCount === 0) {
            if (this.updateProgressHandle) {
                this.refreshUpdateProgress();
            } else {
                Utilities.publishSuccess(ZotMetaL10n.t('none-updated'), ZotMetaL10n.t('select-items'));
            }
            return;
        }
        this.enqueueUpdateBatch(items, window);
    },

    getAllLibraryItems() {
        if (!Zotero.Items || typeof Zotero.Items.getAll !== 'function') {
            return [];
        }
        try {
            return Zotero.Items.getAll();
        } catch (error) {
            return [];
        }
    },

    getItemTypeLabel(item) {
        return ZotMetaL10n.itemType(item.itemTypeID);
    },

    getLibraryStats() {
        var items = this.getAllLibraryItems();
        var stats = {
            totalItems: 0,
            attachments: 0,
            failed: 0,
            skipped: 0,
            typeDistribution: []
        };
        var typeCounts = {};

        for (let item of items) {
            if (Utilities.isAttachment(item)) {
                stats.attachments++;
                continue;
            }
            if (!Utilities.isRegularItem(item)) {
                continue;
            }
            stats.totalItems++;
            if (Utilities.hasTag(item, Utilities.failedTag)) {
                stats.failed++;
            }
            if (Utilities.hasTag(item, Utilities.skippedTag)) {
                stats.skipped++;
            }
            var typeLabel = this.getItemTypeLabel(item);
            typeCounts[typeLabel] = (typeCounts[typeLabel] || 0) + 1;
        }

        for (let typeLabel in typeCounts) {
            stats.typeDistribution.push({
                label: typeLabel,
                count: typeCounts[typeLabel]
            });
        }
        stats.typeDistribution.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
        return stats;
    },

    showControlPanel(window = null) {
        this.openPreferencesPane();
    },

    openPreferencesPane() {
        var internalUtilities = Zotero.Utilities && Zotero.Utilities.Internal;
        if (!internalUtilities || typeof internalUtilities.openPreferences !== 'function') {
            Utilities.publishError(ZotMetaL10n.t('settings-unavailable'), ZotMetaL10n.t('settings-open-error'));
            return;
        }

        try {
            internalUtilities.openPreferences("zotmeta-prefpane");
        } catch (error) {
            this.log("Unable to open Zotero preferences: " + error);
            Utilities.publishError(ZotMetaL10n.t('settings-unavailable'), ZotMetaL10n.t('settings-open-error'));
        }
    },

    getAttachmentTitle(attachment, forDisplay = false) {
        if (attachment.getField && attachment.getField('title')) {
            return attachment.getField('title');
        }
        if (attachment.attachmentFilename) {
            return attachment.attachmentFilename.replace(/\.pdf$/i, "");
        }
        // The stored placeholder stays stable across languages; localize UI only.
        return forDisplay ? ZotMetaL10n.t('untitled-attachment') : "Untitled attachment";
    },

    getParentItemType(identifiers) {
        if (identifiers.DOI) {
            return 'journalArticle';
        }
        if (identifiers.arxivID) {
            return 'preprint';
        }
        return 'document';
    },

    async createParentItemForAttachment(attachment, batch = {}) {
        if (!Utilities.isPDFAttachment(attachment)) {
            return 2;
        }
        if (attachment.parentID) {
            return 2;
        }

        var identifiers = await Utilities.extractIdentifiersFromAttachment(attachment);
        var parent = new Zotero.Item(this.getParentItemType(identifiers));
        parent.libraryID = attachment.libraryID;
        parent.setField('title', this.getAttachmentTitle(attachment));
        Utilities.applyIdentifiersToItem(parent, identifiers);
        await Utilities.saveItemTx(parent);

        attachment.parentID = parent.id;
        await Utilities.saveItemTx(attachment);

        var updater = this.getMetadataUpdater(parent);
        if (updater) {
            var title = Utilities.getItemDisplayTitle(parent);
            var status;
            try {
                status = await this.updateItemWithRetry(updater, parent, title, batch);
            } catch (error) {
                this.logItemFailure(parent, title, error, batch.id);
                return 1;
            }
            await Utilities.markItemUpdateStatus(parent, status);
            return status;
        }
        return 0;
    },

    async createParentItemsForSelectedAttachments() {
        var pane = Zotero.getActiveZoteroPane();
        var selectedItems = pane.getSelectedItems();
        var window = this.getActiveWindow(pane);
        var attachments = selectedItems.filter(item => Utilities.isPDFAttachment(item));
        if (attachments.length === 0) {
            Utilities.publishSuccess(ZotMetaL10n.t('none-created'), ZotMetaL10n.t('select-pdfs'));
            return;
        }

        var progressHandle = Utilities.initializeModernProgress(
            window,
            ZotMetaL10n.t('creating-parents'),
            ZotMetaL10n.t('preparing-pdfs', { count: ZotMetaL10n.number(attachments.length) })
        );

        var batch = { id: ++this.updateBatchCounter };
        var created = 0;
        var failed = 0;
        var skipped = 0;
        var completed = 0;
        for (let attachment of attachments) {
            var progressItem = Utilities.addProgressItem(
                progressHandle,
                ZotMetaL10n.t('queued-title', { title: this.getAttachmentTitle(attachment, true) })
            );
            var status = 1;
            try {
                status = await this.createParentItemForAttachment(attachment, batch);
                if (status === 2) {
                    skipped++;
                } else if (status === 0) {
                    created++;
                } else {
                    failed++;
                }
            } catch (error) {
                failed++;
                this.log("Failed to create parent item: " + error);
            }

            completed++;
            var progress = Math.round(completed / attachments.length * 100);
            Utilities.updateProgressItem(
                progressItem,
                100,
                ZotMetaL10n.t(status === 2 ? 'skipped-title' : status === 1 ? 'failed-title' : 'done-title', {
                    title: this.getAttachmentTitle(attachment, true)
                }),
                true,
                status === 1
            );
            Utilities.publishProgress(
                progressHandle,
                progress,
                Utilities.formatBatchProgress(completed, attachments.length, created, failed, skipped),
                ZotMetaL10n.t('creating-parents')
            );
        }

        this.log('Parent batch completed: ' + JSON.stringify({ batchID: batch.id, total: completed, created, failed, skipped }));
        var summary = ZotMetaL10n.t('created-count', { count: ZotMetaL10n.number(created) });
        if (failed > 0) {
            summary += ZotMetaL10n.t('list-separator') + ZotMetaL10n.t('failed-count', { count: ZotMetaL10n.number(failed) });
        }
        if (skipped > 0) {
            summary += ZotMetaL10n.t('list-separator') + ZotMetaL10n.t('skipped-count', { count: ZotMetaL10n.number(skipped) });
        }
        summary += ZotMetaL10n.t('sentence-end');
        var title = ZotMetaL10n.t(failed > 0 ? 'parents-with-issues' : 'parents-created');
        Utilities.publishFinishedProgress(progressHandle, summary, title, failed > 0);
    }
};
