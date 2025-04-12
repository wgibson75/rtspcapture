// Used by the browse snapshots EJS template

class Snapshots {
  #NAVIGATE_PREV       = 0;
  #NAVIGATE_NEXT       = 1;
  #SNAPSHOT_FILTER_ALL = '*';

  #mainId   = null;
  #timeId   = null;

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
    if (!(data instanceof Object)) return;
    if (!('snapshots' in data)) return;

    this.#snapshots = data.snapshots;
    this.#showSnapshot();

    if (this.#loadedCb != null) {
      this.#loadedCb();
    }
  }

  #insertSnapshotPane() {
    var p = $('<iframe id="snapshot"></iframe>');
    p.appendTo(`#${this.#mainId}`);
  }

  #showSnapshot() {
    let time = this.#getSnapshotTime();
    let date = new Date(0);
    date.setUTCMilliseconds(time);
    let d = date.toString().split(' ');
    d.splice(5, d.length - 5);
    d.splice(3, 1);
    document.getElementById(this.#timeId).innerHTML = d.join(' ');

    let snapshot = document.getElementById('snapshot');
    snapshot.src = this.#getSnapshotUrl();
  }

  #getSnapshotTime() {
    let filename = this.#snapshots[this.#snapshotsIndex];
    let filenameNoExt = filename.split('.')[0];
    let epoch = filenameNoExt.split('_')[1];
    return epoch;
  }

  #getSnapshotUrl() {
    return 'snapshots/' + this.#snapshots[this.#snapshotsIndex];
  }

  #updateSnapshotForFilter() {
    if ((this.#filter != this.#SNAPSHOT_FILTER_ALL) &&
        !this.#snapshots[this.#snapshotsIndex].startsWith(this.#filter)) {
      if (this.#lastNavigation == this.#NAVIGATE_NEXT) {
        this.nextSnapshot();
      }
      else {
        this.prevSnapshot();
      }
    }
  }

  setLoadedCb(callback) {
    this.#loadedCb = callback;
  }

  // Get a dictionary of snapshot filters where the keys are the filter labels
  // that include a count in brackets of the number of matching snapshots and
  // the keys are the filter strings.
  getFilters() {
    if (this.#snapshots.length == 0) return undefined;

    let filters = {};
    this.#snapshots.forEach(function (entry) {
      let pieces = entry.split('_');
      pieces.pop();
      let key = pieces.join('_');
      filters[key] = ++filters[key] || 1;
    });
    filters[this.#SNAPSHOT_FILTER_ALL] = Object.values(filters).reduce((accumulator, value) => {
      return accumulator + value;
    }, 0);

    let rval = {};
    for (let key in filters) {
      rval[key + ' (' + filters[key] + ')'] = key;
    }
    return rval;
  }

  getNumSnaphots() {
    return this.#snapshots.length;
  }

  setFilter(filter) {
    this.#filter = filter;
    this.#updateSnapshotForFilter();
  }

  nextSnapshot() {
    if (this.#snapshots.length == 0) return;
    this.#lastNavigation = this.#NAVIGATE_NEXT;

    if (this.#filter == this.#SNAPSHOT_FILTER_ALL) {
      if ((this.#snapshotsIndex + 1) < this.#snapshots.length) {
        this.#snapshotsIndex++;
        this.#showSnapshot();
      }
    }
    else {
      let index = this.#snapshotsIndex;
      while ((index + 1) < this.#snapshots.length) {
        if (this.#snapshots[++index].startsWith(this.#filter)) {
          this.#snapshotsIndex = index;
          this.#showSnapshot();
          break;
        }
      }
    }
  }

  prevSnapshot() {
    if (this.#snapshots.length == 0) return;
    this.#lastNavigation = this.#NAVIGATE_PREV;

    if (this.#filter == this.#SNAPSHOT_FILTER_ALL) {
      if (this.#snapshotsIndex > 0) {
        this.#snapshotsIndex--;
        this.#showSnapshot();
      }
    }
    else {
      let index = this.#snapshotsIndex;
      while (index > 0) {
        if (this.#snapshots[--index].startsWith(this.#filter)) {
          this.#snapshotsIndex = index;
          this.#showSnapshot();
          break;
        }
      }
    }
  }
}

class Control {
  #snapshotsObj   = null;

  #controlId = null;
  #homeId    = null;
  #filterId  = null;
  #prevId    = null;
  #nextId    = null;

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
    if (filters == undefined) return;

    var f = $('<select />').attr('id', 'filterSelect').attr('class', 'control');
    Object.keys(filters).toSorted().forEach(function (entry) {
      $('<option />', {value: entry, text: entry}).appendTo(f);
    });
    f.appendTo(`#${this.#filterId}`);

    $("#filterSelect").on('change', this.#applyFilter.bind(this));
  }

  #applyFilter() {
    if (this.#snapshotsObj.getNumSnaphots() == 0) return;

    // Take the focus off the filter selection menu to prevent problems with
    // using the left/right cursor keys to then navigate snapshots (e.g. on iPad)
    $('#filterSelect').blur();

    let filter = $('#filterSelect').find(':selected').text().split(' (')[0];
    this.#snapshotsObj.setFilter(filter);
  }

  home(button) {
    document.location.replace('/');
  }

  prevSnapshot(button) {
    this.#snapshotsObj.prevSnapshot();
  }

  nextSnapshot(buttno) {
    this.#snapshotsObj.nextSnapshot();
  }
}
