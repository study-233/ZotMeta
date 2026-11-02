Journal = {
    generateAuthor(author) {
        if (!author) {
            return null;
        }
        if (author.literal) {
            return {
                "firstName": "",
                "lastName": author.literal,
                "creatorType": "author"
            };
        }
        if (!author.given && !author.family) {
            return null;
        }
        return {
            "firstName": author["given"] || "",
            "lastName": author["family"] || "",
            "creatorType": "author"
        };
    },

    generateAuthors (authors) {
        var newAuthorList = [];
        if (authors) {
            authors.forEach(author => {
                var creator = this.generateAuthor(author);
                if (creator) {
                    newAuthorList.push(creator);
                }
            });
        }
        return newAuthorList;
    },

    generateDate (date) {
        if (!date) {
            return null;
        }
        if (date.length > 0) {
            return date[0].join("-");
        }
        else {
            return null;
        }
    },

    getPublicationDate(dataJson) {
        var dateParts = Utilities.safeGetFromJson(dataJson, ["published-print", "date-parts"]);
        if (!dateParts) {
            dateParts = Utilities.safeGetFromJson(dataJson, ["published", "date-parts"]);
        }
        if (!dateParts) {
            dateParts = Utilities.safeGetFromJson(dataJson, ["issued", "date-parts"]);
        }
        return this.generateDate(dateParts);
    },

    getFirstText(value) {
        if (Array.isArray(value)) {
            return value.length > 0 ? value[0] : null;
        }
        return value;
    },

    generateTitle(dataJson) {
        var Title = this.getFirstText(Utilities.safeGetFromJson(dataJson, ["title"]));
        var Subtitle = this.getFirstText(Utilities.safeGetFromJson(dataJson, ["subtitle"]));

        return Utilities.combineTitleAndSubtitle(Title, Subtitle);
    },

    async getMetaData(item, reasons) {
        if (item.itemTypeID !== Zotero.ItemTypes.getID('journalArticle')) {
            return null;
        }
        for (var source of Utilities.getJournalSourceOrder()) {
            try {
                var metadata = source === 'doi' ? await this.getDOIMetaData(item, reasons) : await PubMed.getMetaData(item, reasons);
                if (metadata && Object.values(metadata).some(value =>
                    value !== undefined && value !== null && !Utilities.isEmpty(value))) {
                    return metadata;
                }
                if (metadata) reasons?.add(source + ': no usable metadata fields in response');
            } catch (error) {
                reasons?.add(source + ': ' + error);
            }
        }
        return null;
    },

    getDOIMetaData(item, reasons) {
        if (item.itemTypeID !== Zotero.ItemTypes.getID('journalArticle')) {
            // Utilities.publishError("Unsupported Item Type", "Only Journal Article is supported.")
            return null;
        }
        var doi = PubMed.normalizeDOI(item.getField('DOI'));
        if (!doi) {
            return Utilities.lookupFailure(reasons, 'DOI: missing DOI', false);
        }

        var url = 'https://doi.org/' + encodeURI(doi).replace(/\?/g, '%3F').replace(/#/g, '%23');
        const headers = new Headers({'Accept': 'application/vnd.citationstyles.csl+json'});
        var requestInfo = { method: 'GET', headers };
        return Utilities.requestMetadataText('DOI', url, requestInfo, reasons)
            .then(data => Utilities.parseJsonOrNull(data, 'DOI', reasons))
            .then(dataJson => {
                if (!dataJson) {
                    return null;
                }
                var Title = this.generateTitle(dataJson);
                var Authors = this.generateAuthors(Utilities.safeGetFromJson(dataJson, ["author"]));
                var Publication = Utilities.decodeHTMLEntities(this.getFirstText(Utilities.safeGetFromJson(dataJson, ["container-title"])));
                var Volume = Utilities.safeGetFromJson(dataJson, ["volume"]);
                var Issue = Utilities.safeGetFromJson(dataJson, ["issue"]);
                var Pages = Utilities.safeGetFromJson(dataJson, ["page"]);
                var PublishDate = this.getPublicationDate(dataJson);
                var JournalAbbr = Utilities.decodeHTMLEntities(this.getFirstText(Utilities.safeGetFromJson(dataJson, ["container-title-short"])));
                var Language = Utilities.safeGetFromJson(dataJson, ["language"]);
                return {
                            "Title": Title ? Title : "",
                            "Authors": Authors ? Authors : "",
                            "Publication": Publication ? Publication : "",
                            "Volume": Volume ? Volume : "",
                            "Issue": Issue ? Issue : "",
                            "Pages": Pages ? Pages : "",
                            "PublishDate": PublishDate ? PublishDate : "",
                            "JournalAbbr": JournalAbbr ? JournalAbbr : "",
                            "Language": Language ? Language : ""
                        };
            });
    },

    async updateMetadata(item, reasons) {
        var metaData = await this.getMetaData(item, reasons);
        if (!metaData) {
            return 1;
        }

        var changed = Utilities.applyMetadata(item, metaData, {
            "Title": "title",
            "Authors": "creators",
            "Publication": "publicationTitle",
            "Volume": "volume",
            "Issue": "issue",
            "Pages": "pages",
            "PublishDate": "date",
            "JournalAbbr": "journalAbbreviation",
            "Language": "language",
            "Abstract": "abstractNote",
            "DOI": "DOI"
        });
        changed = PubMed.applyIdentifiers(item, metaData) || changed;
        if (!changed) {
            reasons?.add('Journal: no applicable fields or identifiers in returned metadata');
            return 1;
        }
        await Utilities.saveItemTx(item);
        return 0;
    }
}
