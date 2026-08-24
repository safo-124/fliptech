/**
 * Background photograph upload for the provider form.
 *
 * Written as plain browser JavaScript with no build step, because the Django
 * admin has none and adding one would put a toolchain in the path of every
 * future admin change.
 *
 * The field constraint drives the design: a workshop in Tema on two bars of
 * signal. So each photograph is its own request, failures retry with backoff
 * rather than surfacing immediately, and nothing here touches the surrounding
 * form — the officer keeps typing while images go up behind them, and a form
 * submit that fails does not take the photographs with it.
 */
(function () {
  "use strict";

  var MAX_ATTEMPTS = 4;
  var BACKOFF_MS = [0, 2000, 6000, 15000];

  function csrfToken() {
    var input = document.querySelector("[name=csrfmiddlewaretoken]");
    if (input) return input.value;
    var match = document.cookie.match(/(^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[2]) : "";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function Uploader(root) {
    this.root = root;
    this.urls = {
      upload: root.dataset.uploadUrl,
      base: root.dataset.baseUrl,
    };
    this.list = root.querySelector(".shp-list");
    this.input = root.querySelector(".shp-input");
    this.status = root.querySelector(".shp-status");
    this.queue = 0;
    this.root.setAttribute("aria-busy", "false");
    this.bind();
  }

  Uploader.prototype.bind = function () {
    var self = this;

    this.input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(self.input.files);
      files.forEach(function (file) {
        self.enqueue(file);
      });
      // Let the same file be chosen again after a failure.
      self.input.value = "";
    });

    ["dragenter", "dragover"].forEach(function (name) {
      self.root.addEventListener(name, function (event) {
        event.preventDefault();
        self.root.classList.add("shp-dragging");
      });
    });
    ["dragleave", "drop"].forEach(function (name) {
      self.root.addEventListener(name, function (event) {
        event.preventDefault();
        self.root.classList.remove("shp-dragging");
      });
    });
    this.root.addEventListener("drop", function (event) {
      var files = Array.prototype.slice.call(event.dataTransfer.files);
      files.forEach(function (file) {
        self.enqueue(file);
      });
    });

    // A dropped connection is normal here, so say so plainly rather than
    // letting uploads fail silently.
    window.addEventListener("offline", function () {
      self.setStatus("No connection. Uploads will resume automatically.", "warn");
    });
    window.addEventListener("online", function () {
      self.setStatus("Back online.", "ok");
    });
  };

  Uploader.prototype.setStatus = function (message, tone) {
    this.status.textContent = message || "";
    this.status.className = "shp-status" + (tone ? " shp-" + tone : "");
  };

  Uploader.prototype.enqueue = function (file) {
    var empty = this.list.querySelector(".shp-empty");
    if (empty) empty.remove();

    var card = el("div", "shp-item shp-uploading");
    card.dataset.fileName = file.name;
    card.setAttribute("aria-busy", "true");
    card.setAttribute("aria-label", "Uploading " + file.name);
    var thumb = el("div", "shp-thumb");
    var name = el("div", "shp-name", file.name);
    var bar = el("div", "shp-bar");
    var fill = el("span", "shp-fill");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Upload progress for " + file.name);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", "0");
    bar.appendChild(fill);

    // Show the local file immediately. On a slow link the officer sees the
    // photograph they just took rather than a spinner.
    if (window.URL && window.URL.createObjectURL) {
      var preview = el("img");
      preview.src = window.URL.createObjectURL(file);
      preview.alt = "Preview of " + file.name;
      preview.addEventListener(
        "load",
        function () {
          window.URL.revokeObjectURL(preview.src);
        },
        { once: true }
      );
      thumb.appendChild(preview);
    }

    card.appendChild(thumb);
    card.appendChild(name);
    card.appendChild(bar);
    this.list.insertBefore(card, this.list.firstChild);

    this.queue += 1;
    this.updateQueue();
    this.send(file, card, fill, 0);
  };

  Uploader.prototype.updateQueue = function () {
    this.root.setAttribute("aria-busy", String(this.queue > 0));
    if (this.queue > 0) {
      this.setStatus(this.queue + " uploading…", "busy");
    } else {
      this.setStatus("All photographs saved.", "ok");
    }
  };

  Uploader.prototype.send = function (file, card, fill, attempt) {
    var self = this;
    var form = new FormData();
    form.append("image", file);

    var request = new XMLHttpRequest();
    request.open("POST", this.urls.upload, true);
    request.setRequestHeader("X-CSRFToken", csrfToken());
    request.setRequestHeader("X-Requested-With", "XMLHttpRequest");

    request.upload.addEventListener("progress", function (event) {
      if (event.lengthComputable) {
        var percent = Math.round((event.loaded / event.total) * 100);
        fill.style.width = percent + "%";
        fill.parentNode.setAttribute("aria-valuenow", String(percent));
      }
    });

    request.addEventListener("load", function () {
      var payload = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch (e) {
        payload = {};
      }

      if (request.status === 201) {
        self.queue -= 1;
        self.updateQueue();
        self.replaceWithSaved(card, payload);
        return;
      }

      // 4xx is the server refusing this file — too large, not an image, no
      // permission. Retrying cannot help, so stop and say why.
      if (request.status >= 400 && request.status < 500) {
        self.queue -= 1;
        self.updateQueue();
        self.markFailed(card, payload.detail || "Rejected.", false);
        return;
      }

      self.retry(file, card, fill, attempt, payload.detail || "Server error.");
    });

    request.addEventListener("error", function () {
      self.retry(file, card, fill, attempt, "Connection lost.");
    });
    request.addEventListener("timeout", function () {
      self.retry(file, card, fill, attempt, "Timed out.");
    });

    request.timeout = 120000;
    request.send(form);
  };

  Uploader.prototype.retry = function (file, card, fill, attempt, reason) {
    var self = this;
    var next = attempt + 1;

    if (next >= MAX_ATTEMPTS) {
      this.queue -= 1;
      this.updateQueue();
      this.markFailed(card, reason + " Gave up after " + MAX_ATTEMPTS + " attempts.", true, file);
      return;
    }

    card.classList.add("shp-retrying");
    var wait = BACKOFF_MS[next];
    var note = card.querySelector(".shp-note") || el("div", "shp-note");
    note.textContent = reason + " Retrying in " + Math.round(wait / 1000) + "s…";
    if (!note.parentNode) card.appendChild(note);

    setTimeout(function () {
      card.classList.remove("shp-retrying");
      fill.style.width = "0%";
      fill.parentNode.setAttribute("aria-valuenow", "0");
      self.send(file, card, fill, next);
    }, wait);
  };

  Uploader.prototype.markFailed = function (card, message, allowManualRetry, file) {
    var self = this;
    card.classList.remove("shp-uploading", "shp-retrying");
    card.classList.add("shp-failed");
    card.setAttribute("aria-busy", "false");
    card.setAttribute(
      "aria-label",
      "Upload failed for " + (card.dataset.fileName || "photograph")
    );

    var note = card.querySelector(".shp-note") || el("div", "shp-note");
    note.textContent = message;
    note.setAttribute("role", "alert");
    if (!note.parentNode) card.appendChild(note);

    if (allowManualRetry && file) {
      var again = el("button", "shp-btn", "Try again");
      again.type = "button";
      again.addEventListener("click", function () {
        card.remove();
        self.enqueue(file);
      });
      card.appendChild(again);
    } else {
      var dismiss = el("button", "shp-btn", "Remove");
      dismiss.type = "button";
      dismiss.addEventListener("click", function () {
        card.remove();
      });
      card.appendChild(dismiss);
    }
  };

  Uploader.prototype.replaceWithSaved = function (card, photo) {
    card.remove();
    this.list.insertBefore(this.buildSaved(photo), this.list.firstChild);
  };

  Uploader.prototype.buildSaved = function (photo) {
    var self = this;
    var card = el("div", "shp-item shp-saved");
    card.dataset.photoId = photo.id;
    card.setAttribute(
      "aria-label",
      photo.caption ? "Saved photograph: " + photo.caption : "Saved workshop photograph"
    );

    var thumb = el("div", "shp-thumb");
    var image = el("img");
    image.src = photo.url;
    image.alt = photo.caption || "Workshop photograph";
    image.loading = "lazy";
    thumb.appendChild(image);
    card.appendChild(thumb);

    var caption = el("input", "shp-caption");
    caption.type = "text";
    caption.placeholder = "Caption (optional)";
    caption.value = photo.caption || "";
    caption.setAttribute("aria-label", "Photograph caption");
    caption.addEventListener("blur", function () {
      self.saveCaption(photo.id, caption.value, card);
    });
    card.appendChild(caption);

    var remove = el("button", "shp-btn shp-remove", "Delete");
    remove.type = "button";
    remove.setAttribute("aria-label", "Delete photograph");
    remove.addEventListener("click", function () {
      if (!window.confirm("Delete this photograph?")) return;
      self.deletePhoto(photo.id, card);
    });
    card.appendChild(remove);

    if (photo.exif_stripped) {
      card.appendChild(el("div", "shp-meta", "Location data removed"));
    }
    return card;
  };

  Uploader.prototype.post = function (url, body, onDone, onFail) {
    var request = new XMLHttpRequest();
    request.open("POST", url, true);
    request.setRequestHeader("X-CSRFToken", csrfToken());
    request.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    request.addEventListener("load", function () {
      if (request.status >= 200 && request.status < 300) onDone(request);
      else onFail(request);
    });
    request.addEventListener("error", function () {
      onFail(request);
    });
    request.send(body);
  };

  Uploader.prototype.saveCaption = function (photoId, value, card) {
    var self = this;
    var body = new FormData();
    body.append("caption", value);
    this.post(
      this.urls.base + photoId + "/caption/",
      body,
      function () {
        self.setStatus("Caption saved.", "ok");
        card.classList.remove("shp-failed");
      },
      function () {
        self.setStatus("Caption not saved — check the connection.", "warn");
        card.classList.add("shp-failed");
      }
    );
  };

  Uploader.prototype.deletePhoto = function (photoId, card) {
    var self = this;
    this.post(
      this.urls.base + photoId + "/delete/",
      new FormData(),
      function () {
        card.remove();
        self.setStatus("Photograph deleted.", "ok");
      },
      function () {
        self.setStatus("Could not delete — check the connection.", "warn");
      }
    );
  };

  document.addEventListener("DOMContentLoaded", function () {
    var roots = document.querySelectorAll("[data-photo-uploader]");
    Array.prototype.forEach.call(roots, function (root) {
      var uploader = new Uploader(root);
      // Existing photographs are rendered by the server; wire up their
      // caption and delete controls through the same code path.
      var existing = root.querySelectorAll(".shp-existing");
      Array.prototype.forEach.call(existing, function (node) {
        var photo = {
          id: node.dataset.photoId,
          url: node.dataset.url,
          caption: node.dataset.caption,
          exif_stripped: node.dataset.exifStripped === "true",
        };
        node.parentNode.replaceChild(uploader.buildSaved(photo), node);
      });
    });
  });
})();
