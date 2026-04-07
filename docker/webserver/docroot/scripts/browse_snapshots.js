// Used by the browse snapshots EJS template

class Snapshots {
    #NAVIGATE_PREV       = 0;
    #NAVIGATE_NEXT       = 1;
    #SNAPSHOT_FILTER_ALL = '*';

    #mainId = null;
    #timeId = null;

    #loadedCb       = null;
    #snapshots      = [];
    #snapshotsIndex = 0;
    #lastNavigation = this.#NAVIGATE_NEXT;
    #filter         = this.#SNAPSHOT_FILTER_ALL;

    constructor(jsonSummaryFile, elementIds) {
        this.#mainId = elementIds["mainId"];
        this.#timeId = elementIds["timeId"];

        this.#insertSnapshotPane();

        $.getJSON(jsonSummaryFile, this.#loadSnapshotData.bind(this));
    }

    #loadSnapshotData(data) {
        if (!data?.snapshots) return;

        this.#snapshots = data.snapshots;
        this.#showSnapshot();
        this.#loadedCb?.();
    }

    #insertSnapshotPane() {
        var p = $('<iframe id="snapshot"></iframe>');
        p.appendTo(`#${this.#mainId}`);
    }

    #showSnapshot() {
        const time = this.#getSnapshotTime();
        const date = new Date(time);

        // Formats to: "Tue Apr 07 16:50:00" (Adjust options as needed)
        const formattedDate = date.toLocaleString('en-GB', {
            weekday: 'short',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).replace(/,/g, '');

        document.getElementById(this.#timeId).textContent = formattedDate;
        document.getElementById('snapshot').src = this.#getSnapshotUrl();
    }

    #getSnapshotTime() {
        const filename = this.#snapshots[this.#snapshotsIndex];
        const match = filename.match(/_(\d+)/);
        return match ? Number(match[1]) : 0;
    }

    #getSnapshotUrl() {
        return 'snapshots/' + this.#snapshots[this.#snapshotsIndex];
    }

    #updateSnapshotForFilter() {
        const current = this.#snapshots[this.#snapshotsIndex];

        if (this.#filter === this.#SNAPSHOT_FILTER_ALL || current.startsWith(this.#filter)) {
            return;
        }

        this.#lastNavigation === this.#NAVIGATE_NEXT 
            ? this.nextSnapshot() 
            : this.prevSnapshot();
    }

    setLoadedCb(callback) {
        this.#loadedCb = callback;
    }

    // Get a dictionary of snapshot filters where the keys are the filter labels
    // that include a count in brackets of the number of matching snapshots and
    // the keys are the filter strings.
    getFilters() {
        if (this.#snapshots.length === 0) return undefined;

        // Count occurrences of each prefix
        const counts = this.#snapshots.reduce((acc, entry) => {
            const prefix = entry.split('_').slice(0, -1).join('_');
            acc[prefix] = (acc[prefix] || 0) + 1;
            return acc;
        }, {});

        // Include the "All" total
        counts[this.#SNAPSHOT_FILTER_ALL] = this.#snapshots.length;

        // Transform each filter entry into the final label
        return Object.fromEntries(
            Object.entries(counts).map(([key, count]) => [`${key} (${count})`, key])
        );
    }

    getNumSnaphots() {
        return this.#snapshots.length;
    }

    getSnapshotIndex() {
        return this.#snapshotsIndex;
    }

    setFilter(filter) {
        this.#filter = filter;
        this.#updateSnapshotForFilter();
    }

    nextSnapshot() {
        if (this.#snapshots.length === 0) return;
        this.#lastNavigation = this.#NAVIGATE_NEXT;

        // Find the next index that matches the filter (starting after the current index)
        const nextIndex = this.#snapshots.findIndex((snap, i) => 
            i > this.#snapshotsIndex && 
            (this.#filter === this.#SNAPSHOT_FILTER_ALL || snap.startsWith(this.#filter))
        );

        if (nextIndex !== -1) {
            this.#snapshotsIndex = nextIndex;
            this.#showSnapshot();
        }
    }

    prevSnapshot() {
        if (this.#snapshots.length === 0) return;
        this.#lastNavigation = this.#NAVIGATE_PREV;

        // Search backwards for the first match that appears before the current index
        const prevIndex = this.#snapshots.findLastIndex((snap, i) => 
            i < this.#snapshotsIndex && 
            (this.#filter === this.#SNAPSHOT_FILTER_ALL || snap.startsWith(this.#filter))
        );

        if (prevIndex !== -1) {
            this.#snapshotsIndex = prevIndex;
            this.#showSnapshot();
        }
    }
}

class Control {
    #BUTTON_PRESS_HIGHLIGHT_TIME_MS = 500;  // Duration of button highlight when pressed

    #controlId = null;
    #homeId    = null;
    #filterId  = null;
    #prevId    = null;
    #nextId    = null;

    #snapshotsObj       = null;
    #buttonPressTimeout = null;
    #pressedButton      = null;

    constructor(snapshotsObj, elementIds) {
      this.#snapshotsObj = snapshotsObj
      this.#snapshotsObj.setLoadedCb(this.#snapshotsLoadedCb.bind(this));

      this.#controlId = elementIds["controlId"];
      this.#homeId    = elementIds["homeId"];
      this.#filterId  = elementIds["filterId"];
      this.#prevId    = elementIds["prevId"];
      this.#nextId    = elementIds["nextId"];
    }

    #snapshotsLoadedCb() {
        let filters = this.#snapshotsObj.getFilters();
        if (filters === undefined) return;

        var f = $('<select />').attr('id', 'filterSelect').attr('class', 'control');
        Object.keys(filters).toSorted().forEach(function (entry) {
          $('<option />', {value: entry, text: entry}).appendTo(f);
        });
        f.appendTo(`#${this.#filterId}`);

        $("#filterSelect").on('change', this.#applyFilter.bind(this));
    }

    #applyFilter() {
        if (this.#snapshotsObj.getNumSnaphots() === 0) return;

        // Take the focus off the filter selection menu to prevent problems with
        // using the left/right cursor keys to then navigate snapshots (e.g. on iPad)
        $('#filterSelect').blur();

        let filter = $('#filterSelect').find(':selected').text().split(' (')[0];
        this.#snapshotsObj.setFilter(filter);
    }

    #showButtonPress(button) {
        if (this.#buttonPressTimeout !== null) {
            clearTimeout(this.#buttonPressTimeout);
            this.#hideButtonPress(this.#pressedButton);
        }
        $(`#${button.id}`).toggleClass("button-highlight");

        this.#pressedButton      = button;
        this.#buttonPressTimeout = setTimeout(this.#hideButtonPress.bind(this), this.#BUTTON_PRESS_HIGHLIGHT_TIME_MS, button);
    }

    #hideButtonPress(button) {
        $(`#${button.id}`).toggleClass("button-highlight");

        this.#buttonPressTimeout = null;
        this.#pressedButton      = null;
    }

    home(button) {
        if (button) this.#showButtonPress(button);
        document.location.replace('/');
    }

    prevSnapshot(button) {
        if (this.#snapshotsObj.getSnapshotIndex() === 0) return;
        if (button) this.#showButtonPress(button);
        this.#snapshotsObj.prevSnapshot();
    }

    nextSnapshot(button) {
        if ((this.#snapshotsObj.getSnapshotIndex() + 1) >= this.#snapshotsObj.getNumSnaphots()) return;
        if (button) this.#showButtonPress(button);
        this.#snapshotsObj.nextSnapshot();
    }
}
