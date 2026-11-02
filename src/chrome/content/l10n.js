// Native string bundles keep synchronous progress APIs synchronous. Static markup
// uses Fluent; select the dynamic bundle explicitly so unsupported locales use English.
var ZotMetaL10n = {
    rootURI: null,
    bundles: new Map(),

    init(rootURI) {
        this.rootURI = rootURI;
        this.bundles.clear();
    },

    get locale() {
        var locale = String(Zotero.locale || Services.locale?.appLocaleAsBCP47 || 'en-US');
        return /^zh-(CN|Hans)(-|$)/i.test(locale) ? 'zh-CN' : 'en-US';
    },

    get formatLocale() {
        var locale = String(Zotero.locale || 'en-US');
        return /^en(-|$)/i.test(locale) ? locale : this.locale;
    },

    getBundle(locale) {
        if (!this.bundles.has(locale)) {
            this.bundles.set(locale, Services.strings.createBundle(
                this.rootURI + 'chrome/locale/' + locale + '/zotmeta.properties'
            ));
        }
        return this.bundles.get(locale);
    },

    t(key, args = {}) {
        var value;
        try {
            value = this.getBundle(this.locale).GetStringFromName(key);
        } catch (error) {
            value = this.getBundle('en-US').GetStringFromName(key);
        }
        return value.replace(/\{(\w+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(args, name) ? String(args[name]) : match);
    },

    number(value) {
        return new Intl.NumberFormat(this.formatLocale).format(value);
    },

    date(value) {
        return new Intl.DateTimeFormat(this.formatLocale, {
            year: 'numeric', month: 'long', day: 'numeric'
        }).format(value);
    },

    itemType(idOrName) {
        // Zotero's own translated schema supplies official terminology in both DB
        // and item-object statistics. Never change itemTypeIDs or stored metadata.
        try {
            var name = Zotero.ItemTypes.getName(idOrName) || idOrName;
            var supported = /^(en|zh-(CN|Hans))(-|$)/i.test(Zotero.locale || 'en-US');
            var labels = supported ? Zotero.Schema?.globalSchemaLocale?.itemTypes : null;
            if (labels?.[name]) return labels[name];
            if (supported &&
                    typeof Zotero.ItemTypes.getLocalizedString === 'function') {
                return Zotero.ItemTypes.getLocalizedString(idOrName);
            }
            return this.t('item-type-' + name);
        } catch (error) {
            return this.t('item-type-unknown');
        }
    }
};
