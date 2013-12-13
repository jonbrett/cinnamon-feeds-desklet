/*
 * Cinnamon RSS feed reader desklet
 *
 * Author: jonbrett.dev@gmail.com
 * Date: 2013
 *
 * Cinnamon RSS feed reader applet is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * Cinnamon RSS feed reader applet is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General
 * Public License for more details.
 * You should have received a copy of the GNU General Public License along
 * with Cinnamon RSS feed reader applet.  If not, see
 * <http://www.gnu.org/licenses/>.
 */

const UUID = "feedsdesklet@jonbrettdev.wordpress.com"

const FEED_IMAGE_HEIGHT_MAX = 100;
const FEED_IMAGE_WIDTH_MAX = 200;
const TOOLTIP_WIDTH = 500.0;
const MIN_MENU_WIDTH = 400;

imports.searchPath.push( imports.ui.appletManager.appletMeta[UUID].path );

const Desklet = imports.ui.desklet;
const Cinnamon = imports.gi.Cinnamon;
const Config = imports.misc.config;
const FeedReader = imports.feedreader;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Gettext = imports.gettext.domain('cinnamon-applets');
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;
const St = imports.gi.St;
const Tooltips = imports.ui.tooltips;
const Util = imports.misc.util;
const _ = Gettext.gettext;

/* Check if current Cinnamon version is greater than or equal to a specific
 * version */
function cinnamon_version_gte(version) {
    let current = Config.PACKAGE_VERSION.split('.').map(function(x) { return parseInt(x); });
    let required = version.split('.').map(function(x) { return parseInt(x); });

    for (i in required) {
        if (required[i] > current[i])
            return false;
        if (required[i] < current[i])
            return true;
    }

    /* If we get here, the versions match exactly */
    return true;
}

/* FeedViewer
 * Displays a single feed
 */

function FeedViewer() {
    this._init.apply(this, arguments);
}

FeedViewer.prototype = {
    _init: function(owner, url, id, params) {

        this.owner = owner;
        this.url = url;
        this.id = id;

        /* Init tab */
        this.tab = new St.BoxLayout();
        this.tab.add(new St.Button({
            label: _("...")
        }));

        /* Init content */
        this.content = new St.BoxLayout({
            vertical: true
        });
        this.content.add(new St.Label({text: _("Loading")}));

        this.scrollview = new St.ScrollView({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
        });
        this.scrollview.add_actor(this.content);

        this.reader = new FeedReader.FeedReader(url,
                '~/.cinnamon/' + UUID + '/' + owner.instance_id,
                {
                    'onUpdate' : Lang.bind(this, this.update),
                    'onError' : Lang.bind(this, this.error)
                });
    },

    refresh: function() {
        this.reader.get();
    },

    update: function() {
        this.content.destroy_all_children();

        /* Update content box with feed children */
        for (var i = 0; i < this.reader.items.length; i++) {
            let box = new St.BoxLayout();

            let icon_name = 'feed-new-symbolic';
            if (this.reader.items[i].read)
                icon_name = 'feed-symbolic';
            let icon = new St.Icon({
                icon_name: icon_name,
                icon_type: St.IconType.SYMBOLIC,
                style_class: 'popup-menu-icon'
            });
            box.add(icon);

            let label = new St.Label({
                text: FeedReader.html2text(this.reader.items[i].title)
            });
            box.add(label, {fill: true, expand: true});

            let button = new St.Button({
                x_align: 0,
                reactive: true,
            });
            button.item = this.reader.items[i];
            button.icon = icon;
            button.connect('clicked', Lang.bind(this, function(button, event) {
                button.icon.set_icon_name('feed-symbolic');
                button.item.open();
            }));
            button.set_child(box);

            this.content.add(button);
        };

        /* Update title */
        if (this.custom_title == undefined) {
            this.tab.destroy_all_children();
            let button = new St.Button({
                label: this.reader.title,
            });
            button.connect('clicked', Lang.bind(this, function(button, event) {
                this.owner.set_feed_to_show(this.id);
            }));

            this.tab.add(button);
        }
    },

    error: function(reader, message, full_message) {
        this.content.destroy_all_children();

        let label = new St.Label({text: message});
        this.content.add(label);
    },

    update_params: function(params) {
        /* TODO */
    },

    get_tab: function() {
        return this.tab;
    },

    get_content: function() {
        return this.scrollview;
    },
}


/* Menu item for displaying a simple message */
function FeedDesklet() {
    this._init.apply(this, arguments);
}

FeedDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, instance_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, instance_id);

        try {
            this.feeds = new Array();
            this.path = metadata.path;
            this.icon_path = metadata.path + '/icons/';
            Gtk.IconTheme.get_default().append_search_path(this.icon_path);

            /* TODO: make size configurable */
            this.width = 400;
            this.height = 500;

            /* Create layout */
            this.tabbox = new St.BoxLayout({
                style_class: "feeds-desklet-tabbox"
            });
            this.contentbox = new St.BoxLayout({
                style_class: "feeds-desklet-contentbox"
            });

            this.mainbox = new St.BoxLayout({vertical: true});
            this.mainbox.set_height(this.height);
            this.mainbox.set_width(this.width);
            this.mainbox.add(this.tabbox);
            this.mainbox.add(this.contentbox);

            this.setContent(this.mainbox);
        } catch (e) {
            global.logError(e);
        }

        this.init_settings();
    },

    draw: function() {
        /* Populate tab box */
        this.tabbox.destroy_all_children();
        for (var i in this.feeds) {
            this.tabbox.add(this.feeds[i].get_tab());
        }
        let padding = new St.Label({
            style_class: "feeds-desklet-tabpadding"
        });
        this.tabbox.add(padding, {fill: true, expand: true});

        /* Populate content box */
        this.contentbox.destroy_all_children();
        if (this.feed_to_show != undefined) {
            this.contentbox.add(this.feed_to_show.get_content());
        } else {
            this.contentbox.add(new St.Label({text: _("No feeds to show")}));
        }
    },

    set_feed_to_show: function(id) {
        global.log("setting feed to " + id);
        this.feed_to_show = this.feeds[id];
        this.draw();
    },

    init_settings: function(instance_id) {
        this.settings = new Settings.DeskletSettings(this, UUID, this.instance_id);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "refresh_interval", "refresh_interval_mins", this.refresh,
                null);

        this.settings.bindProperty(Settings.BindingDirection.IN,
                "show_read_items", "show_read_items", this.update_params, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,
                "max_items", "max_items", this.update_params, null);
        this.settings.bindProperty(Settings.BindingDirection.IN,
                "show_feed_image", "show_feed_image", this.update_params, null);

        this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL,
                "url", "url_list_str", this.url_changed, null);

        this.url_changed();
    },

    /* Converts a settings string into an array of objects, each containing a
     * url and title property */
    parse_feed_urls: function(str) {
        let lines = str.split("\n");
        let url_list = new Array();

        for (var i in lines) {
            /* Strip redundant (leading,trailing,multiple) whitespace */
            lines[i] = lines[i].trim().replace(/\s+/g, " ");

            /* Skip empty lines and lines starting with '#' */
            if (lines[i].length == 0 || lines[i].substring(0, 1) == "#")
                continue;

            /* URL is the first word on the line, the rest of the line is an
             * optional title */
            url_list.push({
                url: lines[i].split(" ")[0],
                title: lines[i].split(" ").slice(1).join(" ")
            });
        }

        return url_list;
    },

    url_changed: function() {
        let url_list = this.parse_feed_urls(this.url_list_str);
        this.feeds_changed(url_list);
    },

    // called when feeds have been added or removed
    feeds_changed: function(url_list) {
        this.feeds = new Array();

        for (var i = 0; i < url_list.length; i++) {
            this.feeds[i] = new FeedViewer(this, url_list[i].url, i, {
                show_read_items: true,
            });
        }
        this.feed_to_show = this.feeds[0];
        this.draw();
        this.refresh();
    },

    update_params: function() {
        for (var i = 0; i < this.feeds.length; i++) {
            this.feeds[i].update_params({
                    max_items: this.max_items,
                    show_read_items: this.show_read_items,
                    show_feed_image: this.show_feed_image
            });
            this.feeds[i].update();
        }
    },

    refresh: function() {
        /* Remove any previous timeout */
        if (this.timer_id) {
            Mainloop.source_remove(this.timer_id);
            this.timer_id = 0;
        }

        /* Update all feed display items */
        for (var i = 0; i < this.feeds.length; i++) {
            this.feeds[i].refresh();
        }

        /* Convert refresh interval from mins -> ms */
        this.timeout = this.refresh_interval_mins * 60 * 1000;

        /* Set the next timeout */
        this.timer_id = Mainloop.timeout_add(this.timeout,
                Lang.bind(this, this.refresh));
    },

    _read_manage_app_stdout: function() {
        /* Asynchronously wait for stdout of management app */
        this._manage_data_stdout.fill_async(-1, GLib.PRIORITY_DEFAULT, null, Lang.bind(this, function(stream, result) {
            if (stream.fill_finish(result) == 0) {
                try {
                    let read = stream.peek_buffer().toString();
                    if (read.length > 0) {
                        this.url_list_str = read;
                        this.url_changed();
                    }
                } catch(e) {
                    global.log(e.toString());
                }
                this._manage_stdout.close(null)
            } else {
                /* Not enough space in stream buffer for all the output#
                 * Double it and retry */
                stream.set_buffer_size(2 * stream.get_buffer_size());
                this._read_manage_app_stdout();
            }
        }));
    },

    /* Feed manager functions */
    manage_feeds: function() {
        let argv = [this.path + "/manage_feeds.py"];
        global.log("Starting : " + argv);
        let [exit, pid, stdin, stdout, stderr] = GLib.spawn_async_with_pipes(
                null,
                argv,
                null,
                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null);

        /* Store stdin, stdout but close stderr */
        this._manage_stdout = new Gio.UnixInputStream({fd: stdout, close_fd: true});
        this._manage_data_stdout = new Gio.DataInputStream({
            base_stream: this._manage_stdout
        });
        this._manage_stdin = new Gio.UnixOutputStream({fd: stdin, close_fd: true});
        this._manage_data_stdin = new Gio.DataOutputStream({
            base_stream: this._manage_stdin
        });
        new Gio.UnixInputStream({fd: stderr, close_fd: true}).close(null);

        /* Write current feeds list to management app stdin */
        this._manage_data_stdin.put_string(this.url_list_str, null);
        this._manage_stdin.close(null);

        /* Get output from management app */
        this._read_manage_app_stdout();
    },
};

function main(metadata, instance_id) {
    return new FeedDesklet(metadata, instance_id);
}
