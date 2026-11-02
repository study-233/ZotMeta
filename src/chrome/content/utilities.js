Utilities = {
    modernProgressStyleID: "zotmeta-progress-style",
    concurrentThreadsPref: "extensions.zotmeta.concurrentThreads",
    itemSaveQueue: Promise.resolve(),
    sourceCooldowns: new Map(),
    failedTag: "ZotMeta: Failed",
    skippedTag: "ZotMeta: Skipped",
    journalSourcePref: "extensions.zotmeta.journalSource",
    tagFailedItemsPref: "extensions.zotmeta.tagFailedItems",
    DOI_RE: /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i,
    ARXIV_RE: /\b(?:arxiv\s*(?:id)?\s*[:：]\s*)?((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)\b/i,

    createElement(doc, tagName, className = null, text = null) {
        var element = doc.createElementNS("http://www.w3.org/1999/xhtml", tagName);
        if (className) {
            element.className = className;
        }
        if (text !== null) {
            element.textContent = text;
        }
        return element;
    },

    ensureModernProgressStyle(doc) {
        if (doc.getElementById(this.modernProgressStyleID)) {
            return;
        }
        var style = this.createElement(doc, "style");
        style.id = this.modernProgressStyleID;
        var theme = this.createElement(doc, "link");
        theme.setAttribute('rel', 'stylesheet');
        theme.setAttribute('href', ZotMetaL10n.rootURI + 'theme.css');
        doc.documentElement.appendChild(theme);
        style.textContent = [
            ".zotmeta-progress-panel{position:fixed;right:18px;bottom:18px;width:360px;max-width:calc(100vw - 36px);z-index:2147483647;background:var(--zotmeta-bg);border:1px solid var(--zotmeta-border);border-radius:8px;box-shadow:0 18px 44px rgba(0,0,0,.24),0 2px 8px rgba(0,0,0,.12);font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--zotmeta-fg);overflow:hidden;backdrop-filter:saturate(1.2) blur(18px)}",
            ".zotmeta-progress-header{display:flex;align-items:flex-start;gap:10px;padding:12px 12px 8px}",
            ".zotmeta-progress-mark{width:20px;height:20px;border-radius:50%;background:var(--zotmeta-accent);box-shadow:inset 0 0 0 5px rgba(255,255,255,.72);flex:0 0 auto;margin-top:1px}",
            ".zotmeta-progress-title{font-weight:650;font-size:13px;line-height:1.25;margin:0 0 3px}",
            ".zotmeta-progress-summary{font-size:12px;line-height:1.35;color:var(--zotmeta-muted);overflow-wrap:anywhere}",
            ".zotmeta-progress-close{appearance:none;border:0;background:transparent;color:var(--zotmeta-muted);font-size:17px;line-height:1;padding:0 2px;cursor:pointer;margin-left:auto}",
            ".zotmeta-progress-close:hover{color:var(--zotmeta-fg)}",
            ".zotmeta-progress-track{height:6px;background:var(--zotmeta-track);border-radius:999px;overflow:hidden;margin:0 12px 10px}",
            ".zotmeta-progress-fill{height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#14b8a6);border-radius:999px;transition:width .22s ease}",
            ".zotmeta-progress-rows{border-top:1px solid var(--zotmeta-border);max-height:220px;overflow:auto}",
            ".zotmeta-progress-row{padding:9px 12px 10px}",
            ".zotmeta-progress-row+.zotmeta-progress-row{border-top:1px solid var(--zotmeta-border)}",
            ".zotmeta-progress-row-text{font-size:12px;line-height:1.35;color:var(--zotmeta-fg);overflow-wrap:anywhere}",
            ".zotmeta-progress-row-track{height:4px;background:var(--zotmeta-track);border-radius:999px;overflow:hidden;margin-top:7px}",
            ".zotmeta-progress-row-fill{height:100%;width:0%;background:var(--zotmeta-accent);border-radius:999px;transition:width .22s ease}",
            ".zotmeta-progress-row.is-error .zotmeta-progress-row-fill,.zotmeta-progress-panel.is-error .zotmeta-progress-fill{background:var(--color-invalid, #dc2626)}",
            ".zotmeta-progress-row.is-done:not(.is-error) .zotmeta-progress-row-fill,.zotmeta-progress-panel.is-done:not(.is-error) .zotmeta-progress-fill{background:var(--accent-green, #16a34a)}",
            ".zotmeta-progress-panel.is-error .zotmeta-progress-mark{background:var(--color-invalid, #dc2626)}",
            ".zotmeta-progress-panel.is-done:not(.is-error) .zotmeta-progress-mark{background:var(--accent-green, #16a34a)}"
        ].join("\n");
        doc.documentElement.appendChild(style);
    },

    getConcurrentThreads(defaultValue = 6) {
        try {
            if (typeof Services !== 'undefined' && Services.prefs) {
                return this.clampConcurrentThreads(Services.prefs.getIntPref(this.concurrentThreadsPref, defaultValue));
            }
        } catch (error) {}
        return this.clampConcurrentThreads(defaultValue);
    },

    setConcurrentThreads(value) {
        var threads = this.clampConcurrentThreads(value);
        if (typeof Services !== 'undefined' && Services.prefs) {
            Services.prefs.setIntPref(this.concurrentThreadsPref, threads);
        }
        return threads;
    },

    clampConcurrentThreads(value) {
        var threads = parseInt(value, 10);
        if (isNaN(threads)) {
            threads = 6;
        }
        return Math.min(Math.max(threads, 1), 12);
    },

    createModernProgressHandle(window, title, message) {
        if (!window || !window.document || !window.document.documentElement) {
            return null;
        }
        var doc = window.document;
        var mount = doc.body || doc.documentElement;
        this.ensureModernProgressStyle(doc);

        var panel = this.createElement(doc, "div", "zotmeta-progress-panel");
        var header = this.createElement(doc, "div", "zotmeta-progress-header");
        var mark = this.createElement(doc, "div", "zotmeta-progress-mark");
        var copy = this.createElement(doc, "div");
        var titleElement = this.createElement(doc, "div", "zotmeta-progress-title", title);
        var summaryElement = this.createElement(doc, "div", "zotmeta-progress-summary", message);
        var closeButton = this.createElement(doc, "button", "zotmeta-progress-close", "x");
        var track = this.createElement(doc, "div", "zotmeta-progress-track");
        var fill = this.createElement(doc, "div", "zotmeta-progress-fill");
        var rows = this.createElement(doc, "div", "zotmeta-progress-rows");

        closeButton.setAttribute("type", "button");
        closeButton.setAttribute("aria-label", ZotMetaL10n.t('close-progress'));
        closeButton.addEventListener("click", () => {
            if (panel.parentNode) {
                panel.parentNode.removeChild(panel);
            }
        });

        copy.appendChild(titleElement);
        copy.appendChild(summaryElement);
        header.appendChild(mark);
        header.appendChild(copy);
        header.appendChild(closeButton);
        track.appendChild(fill);
        panel.appendChild(header);
        panel.appendChild(track);
        panel.appendChild(rows);
        mount.appendChild(panel);

        var handle = {
            type: "modern",
            root: panel,
            titleElement,
            summaryElement,
            fill,
            rows,
            closeTimer: null,
            progress: null,
            changeHeadline(headline) {
                this.titleElement.textContent = headline;
            },
            show() {},
            startCloseTimer(timeout) {
                if (this.closeTimer) {
                    window.clearTimeout(this.closeTimer);
                }
                this.closeTimer = window.setTimeout(() => {
                    if (this.root.parentNode) {
                        this.root.parentNode.removeChild(this.root);
                    }
                }, timeout);
            }
        };
        handle.progress = this.createModernProgressItem(handle, message, true);
        return handle;
    },

    createModernProgressItem(handle, message, isOverall = false) {
        if (isOverall) {
            return {
                setProgress(progress) {
                    handle.fill.style.width = Math.min(Math.max(progress, 0), 100) + "%";
                },
                setText(text) {
                    handle.summaryElement.textContent = text;
                },
                setIcon() {},
                setError() {
                    handle.root.classList.add("is-error");
                }
            };
        }

        var row = this.createElement(handle.root.ownerDocument, "div", "zotmeta-progress-row");
        var text = this.createElement(handle.root.ownerDocument, "div", "zotmeta-progress-row-text", message);
        var track = this.createElement(handle.root.ownerDocument, "div", "zotmeta-progress-row-track");
        var fill = this.createElement(handle.root.ownerDocument, "div", "zotmeta-progress-row-fill");
        track.appendChild(fill);
        row.appendChild(text);
        row.appendChild(track);
        handle.rows.appendChild(row);

        return {
            row,
            setProgress(progress) {
                fill.style.width = Math.min(Math.max(progress, 0), 100) + "%";
            },
            setText(newText) {
                text.textContent = newText;
            },
            setIcon() {},
            setError() {
                row.classList.add("is-error");
            },
            setDone(hasFailures) {
                row.classList.add("is-done");
                if (hasFailures) {
                    row.classList.add("is-error");
                }
            }
        };
    },

    initializeModernProgress(window, title, message) {
        var handle = this.createModernProgressHandle(window, title, message);
        if (!handle) {
            return this.initializeProgress(title, message);
        }
        handle.progress.setProgress(0);
        handle.progress.setText(message);
        return handle;
    },

    createProgressWindow(title, message, icon, closeTimer = null) {
        var progressWindow = new Zotero.ProgressWindow({closeOnClick:true});
        progressWindow.changeHeadline(title);
        progressWindow.progress = new progressWindow.ItemProgress(icon, message);
        progressWindow.show();
        if (closeTimer) {
            progressWindow.startCloseTimer(closeTimer);
        }
        return progressWindow;
    },

    publishError(title, message) {
        var errorIcon = "chrome://zotero/skin/cross.png";
        var progressWindowError = this.createProgressWindow(title, message, errorIcon, 3000);
        progressWindowError.progress.setError();
    },

    publishSuccess(title, message) {
        var successIcon = "chrome://zotero/skin/tick.png";
        this.createProgressWindow(title, message, successIcon, 3000);
    },

    initializeProgress(title, message) {
        var loadingIcon = "chrome://zotero/skin/spinner-16px.png";
        var progressWindowProgress = this.createProgressWindow(title, message, loadingIcon);
        progressWindowProgress.progress.setProgress(0);
        progressWindowProgress.progress.setText(message);
        return progressWindowProgress;
    },

    addProgressItem(handle, message, progress = 0) {
        if (handle.type === "modern") {
            var modernItem = this.createModernProgressItem(handle, message);
            modernItem.setProgress(progress);
            return modernItem;
        }
        var loadingIcon = "chrome://zotero/skin/spinner-16px.png";
        var progressItem = new handle.ItemProgress(loadingIcon, message);
        progressItem.setProgress(Math.min(Math.max(progress, 0), 100));
        return progressItem;
    },

    updateProgressItem(progressItem, progress, message, isFinished = false, hasFailures = false) {
        var validatedProgress = Math.min(Math.max(progress, 0), 100);
        progressItem.setProgress(validatedProgress);
        progressItem.setText(message);
        if (isFinished) {
            if (progressItem.setDone) {
                progressItem.setDone(hasFailures);
            }
            if (hasFailures) {
                var errorIcon = "chrome://zotero/skin/cross.png";
                progressItem.setIcon(errorIcon);
                progressItem.setError();
            } else {
                var successIcon = "chrome://zotero/skin/tick.png";
                progressItem.setIcon(successIcon);
            }
        }
    },

    publishProgress(handle, progress, message, title = null) {
        var validatedProgress = Math.min(Math.max(progress, 0), 100);
        handle.progress.setProgress(validatedProgress);
        handle.progress.setText(message);
        if (validatedProgress === 100) {
            var successIcon = "chrome://zotero/skin/tick.png";
            handle.progress.setIcon(successIcon);
        }
        if (title) {
            handle.changeHeadline(title);
        }
        handle.show();
    },

    publishFinishedProgress(handle, message, title, hasFailures) {
        handle.progress.setProgress(100);
        handle.progress.setText(message);
        if (hasFailures) {
            var errorIcon = "chrome://zotero/skin/cross.png";
            handle.progress.setIcon(errorIcon);
            handle.progress.setError();
            if (handle.root) {
                handle.root.classList.add("is-done", "is-error");
            }
        } else {
            var successIcon = "chrome://zotero/skin/tick.png";
            handle.progress.setIcon(successIcon);
            if (handle.root) {
                handle.root.classList.add("is-done");
            }
        }
        if (title) {
            handle.changeHeadline(title);
        }
        handle.show();
        if (handle.type === "modern") {
            handle.startCloseTimer(8000);
        }
    },

    fetchWithTimeout(url, requestInfo = {}, timeout = 10000) {
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var request = Object.assign({}, requestInfo);
        if (controller && !request.signal) {
            request.signal = controller.signal;
        }

        return new Promise((resolve, reject) => {
            var timer = setTimeout(() => {
                if (controller) {
                    controller.abort();
                }
                reject(new Error('Request timed out'));
            }, timeout);

            fetch(url, request)
                .then(resolve)
                .catch(reject)
                .finally(() => clearTimeout(timer));
        });
    },

    lookupFailure(reasons, message, retryable = true) {
        reasons?.add(message, retryable);
        return null;
    },

    async requestMetadataText(source, url, options, reasons) {
        var host = new URL(url).hostname;
        var cooldown = this.sourceCooldowns.get(host);
        if (!cooldown || cooldown.until <= Date.now()) {
            var response = await this.fetchWithTimeout(url, options, 10000);
            if (response?.status !== 429) {
                if (response?.ok && this.sourceCooldowns.get(host) === cooldown) {
                    this.sourceCooldowns.delete(host);
                }
                return this.responseTextOrNull(response, source, reasons);
            }

            // In-flight responses may already have extended this host's cooldown.
            var now = Date.now();
            cooldown = this.sourceCooldowns.get(host);
            var backoff = cooldown?.until > now ? cooldown.backoff : Math.min((cooldown?.backoff || 1000) * 2, 30000);
            var header = response.headers?.get('Retry-After')?.trim() || '';
            var until = now + backoff;
            if (/^\d+$/.test(header)) {
                until = now + Number(header) * 1000;
            } else if (/^[a-z]{3}/i.test(header) && Number.isFinite(Date.parse(header))) {
                until = Math.max(now, Date.parse(header));
            }
            cooldown = { until: Math.max(until, cooldown?.until || 0), backoff };
            this.sourceCooldowns.set(host, cooldown);
        }
        reasons?.add(source + ': HTTP 429 (rate limited; retry later)', false, cooldown.until);
        return null;
    },

    async responseTextOrNull(response, source, reasons) {
        if (!response || !response.ok) {
            return this.lookupFailure(reasons, source + ': ' + (response ? 'HTTP ' + response.status : 'no response'));
        }
        return await response.text() || this.lookupFailure(reasons, source + ': empty response body');
    },

    parseJsonOrNull(data, source, reasons) {
        if (data === null) return null; // The request already recorded its failure.
        try {
            return JSON.parse(data) || this.lookupFailure(reasons, source + ': empty JSON record');
        } catch (error) {
            return this.lookupFailure(reasons, source + ': invalid JSON response');
        }
    },

    safeGetFromJson(json, keyArray) {
        if (!json) {
            return null;
        }
        var jsonLoc = json;
        for (const key of keyArray) {
            if (jsonLoc !== null && typeof jsonLoc === 'object' && key in jsonLoc) {
                jsonLoc = jsonLoc[key];
            } else {
                return null;
            }
        }
        return jsonLoc;
    },

    decodeHTMLEntities(text) {
        if (typeof text !== 'string' || !text) {
            return text;
        }

        var entities = {
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' '
        };

        return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(match, entity) {
            if (entity.charAt(0) === '#') {
                var isHex = entity.charAt(1).toLowerCase() === 'x';
                var value = isHex ? entity.slice(2) : entity.slice(1);
                var codePoint = parseInt(value, isHex ? 16 : 10);
                if (!isNaN(codePoint)) {
                    return String.fromCharCode(codePoint);
                }
            }
            return entities[entity] || match;
        });
    },

    normalizeWhitespace(text) {
        if (typeof text !== 'string') {
            return text;
        }
        return text.replace(/\s+/g, ' ').trim();
    },

    getJournalSource() {
        try {
            var source = Services.prefs.getStringPref(this.journalSourcePref, 'doi-pubmed');
            return ['doi-pubmed', 'pubmed', 'doi'].includes(source) ? source : 'doi-pubmed';
        } catch (error) {
            return 'doi-pubmed';
        }
    },

    getJournalSourceOrder() {
        var source = this.getJournalSource();
        if (source === 'doi') {
            return ['doi'];
        }
        return source === 'pubmed' ? ['pubmed', 'doi'] : ['doi', 'pubmed'];
    },

    combineTitleAndSubtitle(title, subtitle) {
        title = this.normalizeWhitespace(this.decodeHTMLEntities(title || ''));
        subtitle = this.normalizeWhitespace(this.decodeHTMLEntities(subtitle || ''));
        if (!title || !subtitle) {
            return title || subtitle;
        }
        var comparableTitle = title.toLowerCase().replace(/[.!?]+$/, '');
        var comparableSubtitle = subtitle.toLowerCase().replace(/[.!?]+$/, '');
        var prefix = comparableTitle.slice(0, -comparableSubtitle.length);
        if (comparableTitle === comparableSubtitle ||
            (comparableTitle.endsWith(comparableSubtitle) && /[\s:–—-]$/.test(prefix))) {
            return title;
        }
        return title.replace(/[:\s]+$/, '') + ': ' + subtitle;
    },

    applyMetadata(item, metaData, fieldMap) {
        var changed = false;
        for (const metaKey in fieldMap) {
            var value = metaData[metaKey];
            if (value === undefined || value === null || this.isEmpty(value)) {
                continue;
            }
            var target = fieldMap[metaKey];
            if (target === 'creators') {
                item.setCreators(value);
            } else {
                item.setField(target, value);
            }
            changed = true;
        }
        return changed;
    },

    applyExtraFields(item, fields) {
        var original = item.getField('extra') || '';
        var extra = original;
        for (var [key, value] of Object.entries(fields)) {
            if (!value) {
                continue;
            }
            var line = key + ': ' + this.normalizeWhitespace(value);
            var pattern = new RegExp('^[ \\t]*' + key + '[ \\t]*:[^\\r\\n]*', 'gim');
            var found = false;
            extra = extra.replace(pattern, () => {
                if (found) {
                    return '';
                }
                found = true;
                return line;
            });
            if (!found) {
                extra += (extra && !/[\r\n]$/.test(extra) ? '\n' : '') + line;
            }
        }
        if (extra === original) {
            return false;
        }
        item.setField('extra', extra);
        return true;
    },

    saveItemTx(item) {
        var savePromise = this.itemSaveQueue.then(() => item.saveTx());
        this.itemSaveQueue = savePromise.catch(() => {});
        return savePromise;
    },

    hasTag(item, tagName) {
        if (!item || typeof item.getTags !== 'function') {
            return false;
        }
        var tags = item.getTags();
        for (let tag of tags) {
            var currentTag = typeof tag === 'string' ? tag : tag.tag;
            if (currentTag === tagName) {
                return true;
            }
        }
        return false;
    },

    addTagIfMissing(item, tagName) {
        if (!item || typeof item.addTag !== 'function' || this.hasTag(item, tagName)) {
            return false;
        }
        item.addTag(tagName);
        return true;
    },

    removeTagIfPresent(item, tagName) {
        if (!item || typeof item.removeTag !== 'function' || !this.hasTag(item, tagName)) {
            return false;
        }
        item.removeTag(tagName);
        return true;
    },

    shouldTagFailedItems() {
        try {
            return Services.prefs.getBoolPref(this.tagFailedItemsPref, false);
        } catch (error) {
            return false;
        }
    },

    async markItemUpdateStatus(item, status) {
        var changed = false;
        if (status === 0) {
            changed = this.removeTagIfPresent(item, this.failedTag) || changed;
            changed = this.removeTagIfPresent(item, this.skippedTag) || changed;
        } else if (status === 2) {
            changed = this.removeTagIfPresent(item, this.failedTag) || changed;
            changed = this.addTagIfMissing(item, this.skippedTag) || changed;
        } else {
            changed = this.removeTagIfPresent(item, this.skippedTag) || changed;
            if (this.shouldTagFailedItems()) {
                changed = this.addTagIfMissing(item, this.failedTag) || changed;
            }
        }

        if (changed) {
            await this.saveItemTx(item);
        }
    },

    delay(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    },

    isRegularItem(item) {
        return item && typeof item.isRegularItem === 'function' && item.isRegularItem();
    },

    isAttachment(item) {
        return item && typeof item.isAttachment === 'function' && item.isAttachment();
    },

    isPDFAttachment(item) {
        return this.isAttachment(item)
            && item.attachmentContentType === "application/pdf";
    },

    cleanDOI(doi) {
        if (!doi) {
            return null;
        }
        return doi.replace(/[.,;:)]+$/g, "");
    },

    extractIdentifiersFromText(text) {
        if (!text) {
            return {
                DOI: null,
                arxivID: null
            };
        }

        var doiMatch = text.match(this.DOI_RE);
        var arxivMatch = text.match(this.ARXIV_RE);
        return {
            DOI: doiMatch ? this.cleanDOI(doiMatch[0]) : null,
            arxivID: arxivMatch ? arxivMatch[1] : null
        };
    },

    async getAttachmentFullText(attachment) {
        if (!this.isPDFAttachment(attachment) || !Zotero.Fulltext || !Zotero.File) {
            return "";
        }

        try {
            var cacheFile = Zotero.Fulltext.getItemCacheFile(attachment);
            if (!cacheFile) {
                return "";
            }
            if (typeof cacheFile.exists === 'function' && !cacheFile.exists()) {
                return "";
            }
            return await Zotero.File.getContentsAsync(cacheFile);
        } catch (error) {
            return "";
        }
    },

    async extractIdentifiersFromAttachment(attachment) {
        var text = await this.getAttachmentFullText(attachment);
        return this.extractIdentifiersFromText(text);
    },

    getItemAttachments(item) {
        if (!item || typeof item.getAttachments !== 'function') {
            return [];
        }
        var attachmentIDs = item.getAttachments();
        var attachments = [];
        for (let id of attachmentIDs) {
            var attachment = Zotero.Items.get(id);
            if (attachment) {
                attachments.push(attachment);
            }
        }
        return attachments;
    },

    async extractIdentifiersFromItemAttachments(item) {
        var attachments = this.getItemAttachments(item);
        for (let attachment of attachments) {
            var identifiers = await this.extractIdentifiersFromAttachment(attachment);
            if (identifiers.DOI || identifiers.arxivID) {
                return identifiers;
            }
        }
        return {
            DOI: null,
            arxivID: null
        };
    },

    applyIdentifiersToItem(item, identifiers) {
        var changed = false;
        if (identifiers.DOI && !item.getField('DOI')) {
            item.setField('DOI', identifiers.DOI);
            changed = true;
        }
        if (identifiers.arxivID && !item.getField('archiveID')) {
            item.setField('archiveID', "arXiv:" + identifiers.arxivID);
            changed = true;
        }
        if (identifiers.arxivID && !item.getField('repository')) {
            item.setField('repository', "arXiv");
            changed = true;
        }
        if (identifiers.arxivID && !item.getField('url')) {
            item.setField('url', "https://arxiv.org/abs/" + identifiers.arxivID);
            changed = true;
        }
        return changed;
    },

    getItemDisplayTitle(item) {
        if (!item) {
            return ZotMetaL10n.t('unknown-item');
        }
        try {
            var title = item.getField?.('title');
            if (title) return title;
        } catch (error) {
            // An unloaded item can still be identified by its numeric ID.
        }
        return item.id ? ZotMetaL10n.t('item-id', { id: ZotMetaL10n.number(item.id) }) : ZotMetaL10n.t('untitled-item');
    },

    itemCount(count) {
        return ZotMetaL10n.t(count === 1 ? 'item-one' : 'item-other', { count: ZotMetaL10n.number(count) });
    },

    pluralize(count, singular, plural = null) {
        if (count === 1) {
            return count + " " + singular;
        }
        return count + " " + (plural || singular + "s");
    },

    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) {
            return text;
        }
        return text.slice(0, maxLength - 3).trim() + "...";
    },

    formatBatchProgress(doneCount, totalCount, successCount, failedCount, skippedCount) {
        var message = ZotMetaL10n.t('checked', { done: ZotMetaL10n.number(doneCount), total: ZotMetaL10n.number(totalCount) });
        var details = [];
        if (successCount > 0) {
            details.push(ZotMetaL10n.t('updated-count', { count: ZotMetaL10n.number(successCount) }));
        }
        if (failedCount > 0) {
            details.push(ZotMetaL10n.t('failed-count', { count: ZotMetaL10n.number(failedCount) }));
        }
        if (skippedCount > 0) {
            details.push(ZotMetaL10n.t('skipped-count', { count: ZotMetaL10n.number(skippedCount) }));
        }
        if (details.length > 0) {
            message = ZotMetaL10n.t('details', { message, details: details.join(ZotMetaL10n.t('list-separator')) });
        }
        return message;
    },

    formatBatchRow(batchName, doneCount, totalCount, successCount, failedCount, skippedCount) {
        return ZotMetaL10n.t('batch-row', { batch: batchName, message: this.formatBatchProgress(doneCount, totalCount, successCount, failedCount, skippedCount) });
    },

    formatBatchSummary(successCount, failedCount, skippedCount, failedItems) {
        var parts = [];
        if (successCount > 0) {
            parts.push(ZotMetaL10n.t('updated-items', { items: this.itemCount(successCount) }));
        }
        if (failedCount > 0) {
            parts.push(ZotMetaL10n.t('failed-items', { items: this.itemCount(failedCount) }));
        }
        if (skippedCount > 0) {
            parts.push(ZotMetaL10n.t('skipped-items', { items: this.itemCount(skippedCount) }));
        }
        var summary = parts.length > 0 ? parts.join(ZotMetaL10n.t('list-separator')) + ZotMetaL10n.t('sentence-end') : ZotMetaL10n.t('no-supported-items');

        if (failedItems.length > 0) {
            var shownItems = failedItems.slice(0, 3).map(item => this.truncateText(item, 60));
            summary += ZotMetaL10n.t('failed-titles', { titles: shownItems.join("; ") });
            if (failedItems.length > shownItems.length) {
                summary += ZotMetaL10n.t('more-failed', { count: ZotMetaL10n.number(failedItems.length - shownItems.length) });
            }
            if (!/[.!?。！？]$/.test(summary)) {
                summary += ZotMetaL10n.t('sentence-end');
            }
        }

        return summary;
    },

    getBatchSummaryTitle(successCount, failedCount, skippedCount) {
        if (failedCount > 0 && successCount > 0) {
            return ZotMetaL10n.t('updated-with-issues');
        }
        if (failedCount > 0) {
            return ZotMetaL10n.t('update-failed');
        }
        if (successCount > 0) {
            return ZotMetaL10n.t(skippedCount > 0 ? 'updated-with-skips' : 'updated');
        }
        return ZotMetaL10n.t('none-updated');
    },

    isEmpty(value) {
        if (typeof value === 'string') {
            return value.trim() === '';
        } else if (Array.isArray(value)) {
            return value.length === 0;
        } else if (typeof value === 'object' && value !== null) {
            return Object.keys(value).length === 0;
        } else {
            return false;
        }
    }
};
