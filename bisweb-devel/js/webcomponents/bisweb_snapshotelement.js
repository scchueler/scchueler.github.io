/*  LICENSE
 
 _This file is Copyright 2018 by the Image Processing and Analysis Group (BioImage Suite Team). Dept. of Radiology & Biomedical Imaging, Yale School of Medicine._
 
 BioImage Suite Web is licensed under the Apache License, Version 2.0 (the "License");
 
 - you may not use this software except in compliance with the License.
 - You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
 
 __Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.__
 
 ENDLICENSE */


/**
 * @file A Broswer module. Contains {@link BisWEB_ViewerElements}.
 * @author Xenios Papademetris
 * @version 1.0
 */


"use strict";

const bisgenericio = require('bis_genericio');
const $ = require('jquery');
const webutil = require('bis_webutil');
const filesaver = require('FileSaver');
const bootbox = require('bootbox');
const userPreferences = require('bisweb_userpreferences.js');
const BisWebPanel = require('bisweb_panel.js');
const BisWebImage = require('bisweb_image.js');
const pngReader=require('pngreader_bundle.js');

/**
 * A class to create snapshots from a viewer.
 *
 * @example
 *
 * <bisweb-snapshotelement
 *     bis-layoutwidgetid="#viewer_layout"
 *     bis-dowhite="false"
 *     bis-viewerid="#viewer">
 * </bisweb-snapshotelement>
 *
 * Attributes:
 *      bis-viewerid : the orthogonal viewer to draw in 
 *      bis-layoutwidgetid :  the layout widget to create the GUI in
 *      bis-dowhite :  if true then default background for snapshot is white else it is black.
 */
class SnapshotElement extends HTMLElement {


    constructor() {
        super();
        
        this.data = {
            scale: 3.0,
            dowhite: false,
            crop: true,
        };

        this.testingResolve=null;
        this.testingReject=null;
        this.simplemode=false;
        this.colorselector=null;
        this.enablepanorama=false;
    }


    getElementState() {
        return JSON.parse(JSON.stringify(this.data));
    }

    setElementState(dt) {
        if (!dt)
            return;

        let names=[ 'scale','dowhite','crop' ];
        for (let i=0;i<names.length;i++) {
            let key=names[i];
            if (dt[key] !== undefined)
                this.data[key]= dt[key];
        }

        if (this.colorselector) {
            this.colorselector.prop("checked", this.data.dowhite);
        }
        this.cropselector.prop("checked", this.data.crop);
        this.select.val(this.data.scale - 1);
    }
    
    
    computeGoodRows(in_imgdata, dowhite, border = 20, padding = 10) {

        let ht = in_imgdata.height;
        let wd = in_imgdata.width;

        let badsum = 0;
        if (dowhite)
            badsum = 765;

        let rows = new Int16Array(ht);
        let goodrows = 0;

        for (let j = 0; j < ht; j++) {
            let found = false;
            for (let i = 0; i < wd; i++) {
                let offset = (j * wd + i) * 4;
                let sum = 0;
                for (let c = 0; c <= 2; c++)
                    sum += in_imgdata.data[offset + c];
                if (sum !== badsum) {
                    found = true;
                    i = wd + 1;
                }
            }
            if (found) {
                rows[j] = goodrows;
                goodrows += 1;
            } else {
                rows[j] = -1;
            }
        }

        // Add padding;
        if (rows[0] >= 0) {
            rows[0] = border;
        }
        let totalp = border;

        for (let j = 1; j < ht; j++) {
            if (rows[j] >= 0) {
                if (rows[j - 1] < 0) {
                    totalp = totalp + padding;
                }
                rows[j] = rows[j] + totalp;
                goodrows = rows[j] + 1;
            }
        }
        goodrows += border;
        return {
            goodrows: goodrows,
            rows: rows
        };
    }

    computeGoodColumns(in_imgdata, dowhite, beginj = 0, endj = -1, border = 20, padding = 10) {

        let ht = in_imgdata.height;
        let wd = in_imgdata.width;

        if (beginj < 0)
            beginj = 0;
        if (endj < 0)
            endj = ht;

        let badsum = 0;
        if (dowhite)
            badsum = 765;

        let columns = new Int16Array(wd);
        let goodcolumns = 0;

        for (let i = 0; i < wd; i++) {
            let found = false;
            for (let j = beginj; j < endj; j++) {
                let offset = (j * wd + i) * 4;
                let sum = 0;
                for (let c = 0; c <= 2; c++)
                    sum += in_imgdata.data[offset + c];
                if (sum !== badsum) {
                    found = true;
                    j = endj + 1;
                }
            }
            if (found) {
                columns[i] = goodcolumns;
                goodcolumns += 1;
            } else {
                columns[i] = -1;
            }
        }

        if (columns[0] >= 0) {
            columns[0] = border;
        }
        let totalp = border;

        for (let i = 1; i < wd; i++) {
            if (columns[i] >= 0) {
                if (columns[i - 1] < 0) {
                    totalp = totalp + padding;
                }
                columns[i] = columns[i] + totalp;
                goodcolumns = columns[i] + 1;
            }
        }
        goodcolumns = goodcolumns + border;

        return {
            goodcolumns: goodcolumns,
            columns: columns
        };
    }

    autoCrop(in_canvas, dowhite, hasOverlayColorbar) {

        let wd = in_canvas.width;
        let ht = in_canvas.height;
        let in_imgdata = in_canvas.getContext("2d").getImageData(0, 0, wd, ht);

        let border = Math.round(0.01 * wd);
        if (border < 4)
            border = 4;
        let padding = Math.round(border / 4);

        let { goodrows, rows } = this.computeGoodRows(in_imgdata, dowhite, border, padding);

        let beginj = 0, endj = ht;
        if (hasOverlayColorbar)
            endj = Math.round(0.91 * ht);

        let tailgoodcolumns = -1, tailcolumns = null;

        let { goodcolumns, columns } = this.computeGoodColumns(in_imgdata, dowhite, beginj, endj, border, padding);

        if (hasOverlayColorbar) {
            let d = this.computeGoodColumns(in_imgdata, dowhite, endj, ht, border, border);
            tailgoodcolumns = d.goodcolumns;
            tailcolumns = d.columns;
            if (tailgoodcolumns < (border + 10))
                tailgoodcolumns = 0;
        }

        let columnoffset = 0;
        if (tailgoodcolumns > goodcolumns) {
            columnoffset = Math.round((tailgoodcolumns - goodcolumns) / 2);
            goodcolumns = tailgoodcolumns;
        }

        if (hasOverlayColorbar && tailgoodcolumns > 0)
            goodrows = Math.floor(goodrows + border);

        let newcanvas = document.createElement("canvas");
        newcanvas.height = goodrows;
        newcanvas.width = goodcolumns;

        let newctx = newcanvas.getContext("2d");
        let imgdata = newctx.createImageData(goodcolumns, goodrows);
        let l = goodcolumns * goodrows;
        let cl = [0, 0, 0, 255];
        if (dowhite)
            cl = [255, 255, 255, 255];

        for (let i = 0; i < l; i++) {
            for (let c = 0; c <= 3; c++) {
                imgdata.data[i * 4 + c] = cl[c];
            }
        }


        for (let j = 0; j < endj; j++) {
            if (rows[j] >= 0) {
                for (let i = 0; i < wd; i++) {
                    if (columns[i] > 0) {
                        let in_offset = (j * wd + i) * 4;
                        let out_offset = (rows[j] * goodcolumns + columns[i] + columnoffset) * 4;
                        for (let c = 0; c <= 3; c++)
                            imgdata.data[out_offset + c] = in_imgdata.data[in_offset + c];
                    }
                }
            }
        }
        if (hasOverlayColorbar && tailgoodcolumns > 0) {
            let widthoffset = Math.floor((goodcolumns - tailgoodcolumns) / 2);
            for (let j = endj; j < ht; j++) {
                if (rows[j] >= 0) {
                    for (let i = 0; i < wd; i++) {
                        if (tailcolumns[i] > 0) {
                            let in_offset = (j * wd + i) * 4;
                            let out_offset = ((border + rows[j]) * goodcolumns + tailcolumns[i] + widthoffset) * 4;
                            for (let c = 0; c <= 3; c++)
                                imgdata.data[out_offset + c] = in_imgdata.data[in_offset + c];
                        }
                    }
                }
            }
        }

        newctx.putImageData(imgdata, 0, 0);
        return newcanvas;
    }


    createOutputCanvas(img,hasOverlayColorbar=false,scale=1.0,dowhite=false,crop=false) {

        let fillcolor = "#000000";
        if (dowhite)
            fillcolor = "#ffffff";
        
        let outcanvas = document.createElement('canvas');
        outcanvas.width = this.canvaslist[0].width * scale;
        outcanvas.height = this.canvaslist[0].height * scale;

        let ctx = outcanvas.getContext('2d');
        ctx.fillStyle = fillcolor;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillRect(0, 0, outcanvas.width, outcanvas.height);
        for (let i = 0; i < this.canvaslist.length; i++) {
            ctx.drawImage(this.canvaslist[i], 0, 0, outcanvas.width, outcanvas.height);
        }
        ctx.drawImage(img, 0, 0, outcanvas.width, outcanvas.height);

        if (crop) {
            outcanvas = this.autoCrop(outcanvas, dowhite, hasOverlayColorbar);
        }

        return outcanvas;
    }
    
    createsnapshot(img, hasOverlayColorbar = false) {

        // Store scale

        userPreferences.setItem('snapshotscale', this.data.scale);
        if (!this.simplemode)
            userPreferences.setItem('snapshotdowhite', this.data.dowhite);
        userPreferences.storeUserPreferences().catch( (e) => {
            console.log('Failed to save userprefs '+e);
        });
        

        let outcanvas=this.createOutputCanvas(img,hasOverlayColorbar,this.data.scale,this.data.dowhite,this.data.crop);
        this.createsnapshot_internal(outcanvas);
    }

    createsnapshot_internal(outcanvas,fname='snapshot.png') {
        
    
        let outimg=outcanvas.toDataURL("image/png");
        
        let dispimg = $('<img id="dynamic">');
        dispimg.attr('src', outimg);
        dispimg.width(300);

        let a = webutil.creatediv();
        a.append(dispimg);

        setTimeout(function () {
            bootbox.dialog({
                title: 'This is the snapshot (size=' + outcanvas.width + 'x' + outcanvas.height + ').<BR> Click SAVE to output as png.',
                message: a.html(),
                buttons: {
                    ok: {
                        label: "Save To File",
                        className: "btn-success",
                        callback: function () {
                            let blob = bisgenericio.dataURLToBlob(outimg);
                            if (webutil.inElectronApp()) {
                                let reader = new FileReader();
                                reader.onload = function () {
                                    let buf = this.result;
                                    let arr = new Int8Array(buf);

                                    bisgenericio.write({
                                        filename: fname,
                                        title: 'Select file to save snapshot in',
                                        filters: [{ name: 'PNG Files', extensions: ['png'] }],
                                    }, arr, true);
                                };
                                reader.readAsArrayBuffer(blob);
                            } else {
                                filesaver(blob, 'snapshot.png');
                            }
                        }
                    }
                },
                cancel: {
                    label: "Cancel",
                    className: "btn-danger",
                }
            });
        });
        return false;
    }

    requestupdate() {
        const self = this;
        this.viewer.savenextrender(self);
        // THIS IS CRITICAL. Return false to stop event loop since nothing has happened but will
        // in the future. Xenios 2/11/2015
        return false;
    }


    connectedCallback() {


        if (this.getAttribute('bis-dowhite') === 'true')
            this.data.dowhite = true;


        if (this.getAttribute('bis-enablepanorama') === 'true')
            this.enablepanorama=true;
        
        let viewerid = this.getAttribute('bis-viewerid');
        let layoutid = this.getAttribute('bis-layoutwidgetid');
        let viewer = document.querySelector(viewerid);
        let layoutcontroller = document.querySelector(layoutid);

        let simple=viewer.getAttribute('bis-simplemode');
        if (simple==="1" || simple==="true") {
            this.simplemode=true;
            this.data.dowhite=true;
        } 
            
        
        this.viewer = viewer;
        this.viewer.setSnapShotController(this);
        this.renderer = layoutcontroller.renderer;
        this.canvaslist = [layoutcontroller.canvas,
                           layoutcontroller.overlaycanvas];

        this.select = null;

        const self = this;

        let panel=new BisWebPanel(layoutcontroller,
                                  {
                                      'name' : 'Viewer Snapshot',
                                      'dual' : false,
                                      'permanent' : true,
                                      'width' : '300px',
                                  });
        panel.show();

        let basegui=panel.getWidget();
        let base = webutil.creatediv({ parent: basegui });

        let inlineform = $("<form class=\"form-inline\"></form>");
        base.append(inlineform);

        let elem1 = webutil.creatediv({ parent: inlineform });
        let elem2 = webutil.creatediv({ parent: inlineform });

        let c=$('<span>Scale:</span>');
        elem1.append(c);
        c.css({ 'margin-left': '2px', 'margin-right' : '5px', 'font-size': '11px'});

        self.select = webutil.createselect({
            parent: elem1,
            values: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7'],
            position: "top",
            index: Math.floor(self.data.scale) - 1,
            tooltip: "Set size of the snapshot to a multiple of the current viewer size"
        }).change(function (e) {
            self.data.scale = parseInt(e.target.value) + 1;
        });


        if (!this.simplemode) {
        
            self.colorselector =
                webutil.createcheckbox({
                    name: 'White Bkgd',
                    type: "info",
                    checked: self.data.dowhite,
                    parent: elem1,
                    callback: function (sel) {
                        self.data.dowhite = sel;
                    },
                    css: { 'margin-left': '5px' },
                    tooltip: "If on set the viewer background to white",
                });
            
        }
        self.cropselector =
            webutil.createcheckbox({
                name: 'Crop',
                type: "info",
                checked: self.data.crop,
                parent: elem1,
                callback: function (sel) {
                    self.data.crop = sel;
                },
                css: { 'margin-left': '5px' },
                tooltip: "Crop Snapshot",
            });
        

        let upd = function () { self.requestupdate(); };

        webutil.createbutton({
            name: "Take Snapshot",
            type: "info",
            tooltip: "Self will create preview of a snaphot of the viewer that you can then save.",
            position: "top",
            css: {
                'padding': '5px',
                'margin-left': '5px',
                'margin-top': '5px'
            },
            parent: elem2,
            callback: upd,
        });


        if (this.enablepanorama) { 
            webutil.createbutton({
                name: "Take Panorama",
                type: "danger",
                css: {
                    'padding': '5px',
                    'margin-left': '5px',
                    'margin-top': '5px'
                },
                parent: elem2,
                callback: () => { self.createpanorama(); },
            });
        }


        webutil.tooltip(inlineform);

        

        userPreferences.safeGetItem('snapshotscale').then( (v) => {
            if (v !== null) {
                let v2 = parseFloat(v);
                if (v2 !== Math.Nan) {
                    self.data.scale = Math.floor(v);
                    if (self.select !== null)
                        self.select.val(self.data.scale - 1);
                }
            }
        });

        if (!this.simplemode) {
            userPreferences.safeGetItem('snapshotdowhite').then( (v) => {
                self.data.dowhite=v;
                if (self.colorselector !== null)
                    self.colorselector.prop("checked", self.data.dowhite);
            });
        }
    }

    /** function that receives update from viewer once snapshot is requested
     * @param {DataURL} t - dataurl storage of 3d renderer buffer (             let t=renderer.domElement.toDataURL())
     * @param{Boolean} hasOverlayColorbar -- is the viewer a mosaic viewer (run auto crop);
     */
    update(t, hasOverlayColorbar = false) {

        let img = document.createElement('img');
        img.src = t;
        
        setTimeout( () => {
            
            if (this.testingResolve===null) {
                this.createsnapshot(img, hasOverlayColorbar);
            } else {
                this.testingResolve(this.createOutputCanvas(img,hasOverlayColorbar,this.data.scale,this.data.dowhite,this.data.crop));
            }
        }, 500);
    }


    // --------------------------------------------------
    // Testing Code
    

    /*
      * creates a BisWebImage object from a canvas
      * @param{Canvas} in_canvas - the input canvas element
      * @return{BisWebImage} - the output image
      */
    createBisWebImageFromCanvas(in_canvas) {

        let wd = in_canvas.width;
        let ht = in_canvas.height;
        let in_imgdata = in_canvas.getContext("2d").getImageData(0, 0, wd, ht).data;
        let output=new BisWebImage();
        output.initialize();
        output.createImage( {
            type : "uchar",
            numcomponents : 1,
            numframes : 4,
            orientation : 'LPS',
            dimensions : [ wd,ht,1 ],
        });

        let out_imgdata=output.getImageData();
        
        let slicesize=wd*ht;
        let index=0;
        for (let row=0;row<ht;row++) {
            for (let col=0;col<wd;col++) {
                for (let comp=0;comp<=3;comp++) {
                    out_imgdata[comp*slicesize+row*wd+col]=in_imgdata[index];
                    ++index;
                }
            }
        }
        return output;
    }

    /*
      * creates a BisWebImage object from an image element
      * @param{URL} url - the url storing the image (e.g. .png)
      * @return{BisWebImage} - the output image
      */
    createBisWebImageFromURL(url) {

        return new Promise( (resolve,reject) => { 

            bisgenericio.read(url,true).then( (obj) => {
                
                let data=obj.data;
                let reader = new pngReader(data.buffer);
                reader.parse(function(err, png){
                    if (err)
                        reject(err);
                    
                    let ht=png.getHeight();
                    let wd=png.getWidth();

                    
                    let output=new BisWebImage();
                    output.initialize();
                    output.createImage( {
                        type : "uchar",
                        numcomponents : 1,
                        numframes : 4,
                        orientation : 'LPS',
                        dimensions : [ wd,ht,1 ],
                    });
                    
                    let out_imgdata=output.getImageData();
                    let slicesize=wd*ht;
                    let index=0;
                    for (let row=0;row<ht;row++) {
                        for (let col=0;col<wd;col++) {
                            for (let comp=0;comp<=3;comp++) {
                                out_imgdata[comp*slicesize+row*wd+col]=png.pixels[index];
                                ++index;
                            }
                        }
                    }
                    resolve(output);
                });
            }).catch( (e) => { reject(e); });
        });
    }
    
    
    getTestImage() {

        const self=this;

        return new Promise( (resolve,reject) => {

            let finalResolve=( (dat) => {
                self.testingResolve=null;
                self.testingReject=null;
                resolve(dat);
            });

            self.testingResolve=finalResolve;
            self.testingReject=reject;
            self.viewer.savenextrender(self);
        });
    }

    // Panorama stuff
    createpanorama() {

        let oldrmode=this.viewer.internal.rendermode;
        let controlid=this.getAttribute('bis-conncontrol') || null;
        let conncontrol=null;

        if (controlid) {
            conncontrol=document.querySelector(controlid);
            oldrmode=conncontrol.getRenderMode();
        }
        console.log('Conn control=',conncontrol);


        const self=this;
        let pairs = [ [ 1,true ], [ 1,false ], [ 2,false] , [ 2,true ] , [ 0,false ], [ 0,true ] ];
        let canvaslist = [];

        let index=-1;

        let compilepanorama= (() => {
            console.log('Compiling panorama',canvaslist);
            if (conncontrol)
                conncontrol.setRenderMode(oldrmode);
            else
                this.viewer.setRenderMode(oldrmode);
            
            let wd = canvaslist[0].width;
            let ht = canvaslist[0].height;
            for (let i=0;i<canvaslist.length;i++) {
                if (wd< canvaslist[i].width)
                    wd = canvaslist[i].width;
                if (ht< canvaslist[i].height)
                    ht = canvaslist[i].height;
            }
            let outcanvas = document.createElement("canvas");
            outcanvas.height = ht;
            outcanvas.width = wd*canvaslist.length;

            let fillcolor = "#000000";
            if (this.data.dowhite)
                fillcolor = "#ffffff";
            let ctx = outcanvas.getContext('2d');
            ctx.fillStyle = fillcolor;
            ctx.globalCompositeOperation = "source-over";
            ctx.fillRect(0, 0, outcanvas.width, outcanvas.height);
                        
            for (let i=0;i<canvaslist.length;i++) {
                let w = canvaslist[i].width;
                let h = canvaslist[i].height;

                let imgdata = canvaslist[i].getContext("2d").getImageData(0, 0, w, h);
                let x0=Math.floor(wd-w)/2+wd*i;
                let y0=Math.floor(ht-h)/2;
                outcanvas.getContext("2d").putImageData(imgdata, x0, y0);
            }
            this.createsnapshot_internal(outcanvas);
            
        });

        let failed= ( () => {
            if (conncontrol)
                conncontrol.setRenderMode(oldrmode);
            else
                this.viewer.setRenderMode(oldrmode);
        });
        
        let addnext= (() => {
            index=index+1;
            if (index>=pairs.length)
                return compilepanorama();

            this.viewer.set3dview(pairs[index][0],pairs[index][1]);

            let finalResolve=( (dat) => {
                self.testingResolve=null;
                self.testingReject=null;
                canvaslist.push(dat);
                addnext();
            });

            this.testingResolve=finalResolve;
            this.testingReject=failed;
            this.viewer.savenextrender(self);
        });


        //internal.layoutmanager.getcanvas();
        //        internal.context.clearRect(0,0,internal.canvas.width,internal.canvas.height);
        //      internal.overlaycontext.clearRect(0,0,internal.canvas.width,internal.canvas.height);

        conncontrol.setRenderMode(5);
        addnext();
        
        return false;

    }

    saveCanvasToPNG(canvas) {
        this.createsnapshot_internal(canvas);
    }

    
}

module.exports=SnapshotElement;
webutil.defineElement('bisweb-snapshotelement', SnapshotElement);
