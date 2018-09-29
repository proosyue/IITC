// ==UserScript==
// @id             iitc-plugin-s2cells@ny
// @name           IITC-plugin:S2-cell(VIP道館藍色,道館紅色,補給站黃色) 
// @author         ny
// @category       Layer
// @version        0.1.8
// @namespace      https://github.com/proosyue/IITC
// @updateURL      https://github.com/proosyue/IITC/raw/master/build/Release/plugins/IITC-plugin-S2-cell.user.js
// @downloadURL    https://github.com/proosyue/IITC/raw/master/build/Release/plugins/IITC-plugin-S2-cell.user.js
// @description    IITC: Shows various S2 cells on the map
// @include        https://*.ingress.com/intel*
// @include        http://*.ingress.com/intel*
// @match          https://*.ingress.com/intel*
// @match          http://*.ingress.com/intel*
// @include        https://*.ingress.com/mission/*
// @include        http://*.ingress.com/mission/*
// @match          https://*.ingress.com/mission/*
// @match          http://*.ingress.com/mission/*
// @grant          none
// ==/UserScript==

// This plugin is a simple fork of the Regions plugin by Jonatkins
//
// original plugin at:
// https://github.com/jonatkins/ingress-intel-total-conversion


function wrapper(plugin_info) {
  // ensure plugin framework is there, even if iitc is not yet loaded
  if(typeof window.plugin !== 'function') window.plugin = function() {};


  // PLUGIN START ////////////////////////////////////////////////////////


  // use own namespace for plugin
  window.plugin.s2cells = function() {};

  window.plugin.s2cells.setup  = function() {
    /// S2 Geometry functions
    // the regional scoreboard is based on a level 6 S2 Cell
    // - https://docs.google.com/presentation/d/1Hl4KapfAENAOf4gv-pSngKwvS_jwNVHRPZTTDzXXn6Q/view?pli=1#slide=id.i22
    // at the time of writing there's no actual API for the intel map to retrieve scoreboard data,
    // but it's still useful to plot the score cells on the intel map


    // the S2 geometry is based on projecting the earth sphere onto a cube, with some scaling of face coordinates to
    // keep things close to approximate equal area for adjacent cells
    // to convert a lat,lng into a cell id:
    // - convert lat,lng to x,y,z
    // - convert x,y,z into face,u,v
    // - u,v scaled to s,t with quadratic formula
    // - s,t converted to integer i,j offsets
    // - i,j converted to a position along a Hubbert space-filling curve
    // - combine face,position to get the cell id

    //NOTE: compared to the google S2 geometry library, we vary from their code in the following ways
    // - cell IDs: they combine face and the hilbert curve position into a single 64 bit number. this gives efficient space
    //             and speed. javascript doesn't have appropriate data types, and speed is not cricical, so we use
    //             as [face,[bitpair,bitpair,...]] instead
    // - i,j: they always use 30 bits, adjusting as needed. we use 0 to (1<<level)-1 instead
    //        (so GetSizeIJ for a cell is always 1)

    (function() {

      window.S2 = {};


      var LatLngToXYZ = function(latLng) {
        var d2r = Math.PI/180.0;

        var phi = latLng.lat*d2r;
        var theta = latLng.lng*d2r;

        var cosphi = Math.cos(phi);

        return [Math.cos(theta)*cosphi, Math.sin(theta)*cosphi, Math.sin(phi)];
      };

      var XYZToLatLng = function(xyz) {
        var r2d = 180.0/Math.PI;

        var lat = Math.atan2(xyz[2], Math.sqrt(xyz[0]*xyz[0]+xyz[1]*xyz[1]));
        var lng = Math.atan2(xyz[1], xyz[0]);

        return L.latLng(lat*r2d, lng*r2d);
      };

      var largestAbsComponent = function(xyz) {
        var temp = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])];

        if (temp[0] > temp[1]) {
          if (temp[0] > temp[2]) {
            return 0;
          } else {
            return 2;
          }
        } else {
          if (temp[1] > temp[2]) {
            return 1;
          } else {
            return 2;
          }
        }

      };

      var faceXYZToUV = function(face,xyz) {
        var u,v;

        switch (face) {
          case 0: u =  xyz[1]/xyz[0]; v =  xyz[2]/xyz[0]; break;
          case 1: u = -xyz[0]/xyz[1]; v =  xyz[2]/xyz[1]; break;
          case 2: u = -xyz[0]/xyz[2]; v = -xyz[1]/xyz[2]; break;
          case 3: u =  xyz[2]/xyz[0]; v =  xyz[1]/xyz[0]; break;
          case 4: u =  xyz[2]/xyz[1]; v = -xyz[0]/xyz[1]; break;
          case 5: u = -xyz[1]/xyz[2]; v = -xyz[0]/xyz[2]; break;
          default: throw {error: 'Invalid face'};
        }

        return [u,v];
      };




      var XYZToFaceUV = function(xyz) {
        var face = largestAbsComponent(xyz);

        if (xyz[face] < 0) {
          face += 3;
        }

        uv = faceXYZToUV (face,xyz);

        return [face, uv];
      };

      var FaceUVToXYZ = function(face,uv) {
        var u = uv[0];
        var v = uv[1];

        switch (face) {
          case 0: return [ 1, u, v];
          case 1: return [-u, 1, v];
          case 2: return [-u,-v, 1];
          case 3: return [-1,-v,-u];
          case 4: return [ v,-1,-u];
          case 5: return [ v, u,-1];
          default: throw {error: 'Invalid face'};
        }
      };


      var STToUV = function(st) {
        var singleSTtoUV = function(st) {
          if (st >= 0.5) {
            return (1/3.0) * (4*st*st - 1);
          } else {
            return (1/3.0) * (1 - (4*(1-st)*(1-st)));
          }
        };

        return [singleSTtoUV(st[0]), singleSTtoUV(st[1])];
      };



      var UVToST = function(uv) {
        var singleUVtoST = function(uv) {
          if (uv >= 0) {
            return 0.5 * Math.sqrt (1 + 3*uv);
          } else {
            return 1 - 0.5 * Math.sqrt (1 - 3*uv);
          }
        };

        return [singleUVtoST(uv[0]), singleUVtoST(uv[1])];
      };


      var STToIJ = function(st,order) {
        var maxSize = (1<<order);

        var singleSTtoIJ = function(st) {
          var ij = Math.floor(st * maxSize);
          return Math.max(0, Math.min(maxSize-1, ij));
        };

        return [singleSTtoIJ(st[0]), singleSTtoIJ(st[1])];
      };


      var IJToST = function(ij,order,offsets) {
        var maxSize = (1<<order);

        return [
          (ij[0]+offsets[0])/maxSize,
          (ij[1]+offsets[1])/maxSize
        ];
      };

      // hilbert space-filling curve
      // based on http://blog.notdot.net/2009/11/Damn-Cool-Algorithms-Spatial-indexing-with-Quadtrees-and-Hilbert-Curves
      // note: rather then calculating the final integer hilbert position, we just return the list of quads
      // this ensures no precision issues whth large orders (S3 cell IDs use up to 30), and is more
      // convenient for pulling out the individual bits as needed later
      var pointToHilbertQuadList = function(x,y,order) {
        var hilbertMap = {
          'a': [ [0,'d'], [1,'a'], [3,'b'], [2,'a'] ],
          'b': [ [2,'b'], [1,'b'], [3,'a'], [0,'c'] ],
          'c': [ [2,'c'], [3,'d'], [1,'c'], [0,'b'] ],
          'd': [ [0,'a'], [3,'c'], [1,'d'], [2,'d'] ]
        };

        var currentSquare='a';
        var positions = [];

        for (var i=order-1; i>=0; i--) {

          var mask = 1<<i;

          var quad_x = x&mask ? 1 : 0;
          var quad_y = y&mask ? 1 : 0;

          var t = hilbertMap[currentSquare][quad_x*2+quad_y];

          positions.push(t[0]);

          currentSquare = t[1];
        }

        return positions;
      };




      // S2Cell class

      S2.S2Cell = function(){};

      //static method to construct
      S2.S2Cell.FromLatLng = function(latLng,level) {

        var xyz = LatLngToXYZ(latLng);

        var faceuv = XYZToFaceUV(xyz);
        var st = UVToST(faceuv[1]);

        var ij = STToIJ(st,level);

        return S2.S2Cell.FromFaceIJ (faceuv[0], ij, level);
      };

      S2.S2Cell.FromFaceIJ = function(face,ij,level) {
        var cell = new S2.S2Cell();
        cell.face = face;
        cell.ij = ij;
        cell.level = level;

        return cell;
      };


      S2.S2Cell.prototype.toString = function() {
        return 'F'+this.face+'ij['+this.ij[0]+','+this.ij[1]+']@'+this.level;
      };

      S2.S2Cell.prototype.getLatLng = function() {
        var st = IJToST(this.ij,this.level, [0.5,0.5]);
        var uv = STToUV(st);
        var xyz = FaceUVToXYZ(this.face, uv);

        return XYZToLatLng(xyz);
      };

      S2.S2Cell.prototype.getCornerLatLngs = function() {
        var result = [];
        var offsets = [
          [ 0.0, 0.0 ],
          [ 0.0, 1.0 ],
          [ 1.0, 1.0 ],
          [ 1.0, 0.0 ]
        ];

        for (var i=0; i<4; i++) {
          var st = IJToST(this.ij, this.level, offsets[i]);
          var uv = STToUV(st);
          var xyz = FaceUVToXYZ(this.face, uv);

          result.push ( XYZToLatLng(xyz) );
        }
        return result;
      };


      S2.S2Cell.prototype.getFaceAndQuads = function() {
        var quads = pointToHilbertQuadList(this.ij[0], this.ij[1], this.level);

        return [this.face,quads];
      };

      S2.S2Cell.prototype.getNeighbors = function() {

        var fromFaceIJWrap = function(face,ij,level) {
          var maxSize = (1<<level);
          if (ij[0]>=0 && ij[1]>=0 && ij[0]<maxSize && ij[1]<maxSize) {
            // no wrapping out of bounds
            return S2.S2Cell.FromFaceIJ(face,ij,level);
          } else {
            // the new i,j are out of range.
            // with the assumption that they're only a little past the borders we can just take the points as
            // just beyond the cube face, project to XYZ, then re-create FaceUV from the XYZ vector

            var st = IJToST(ij,level,[0.5,0.5]);
            var uv = STToUV(st);
            var xyz = FaceUVToXYZ(face,uv);
            var faceuv = XYZToFaceUV(xyz);
            face = faceuv[0];
            uv = faceuv[1];
            st = UVToST(uv);
            ij = STToIJ(st,level);
            return S2.S2Cell.FromFaceIJ (face, ij, level);
          }
        };

        var face = this.face;
        var i = this.ij[0];
        var j = this.ij[1];
        var level = this.level;


        return [
          fromFaceIJWrap(face, [i-1,j], level),
          fromFaceIJWrap(face, [i,j-1], level),
          fromFaceIJWrap(face, [i+1,j], level),
          fromFaceIJWrap(face, [i,j+1], level)
        ];

      };


    })();


    window.plugin.s2cells.regionLayer = L.layerGroup();

    addLayerGroup('S2 Cells', window.plugin.s2cells.regionLayer, true);

    map.on('moveend', window.plugin.s2cells.update);

    addHook('search', window.plugin.s2cells.search);

    window.plugin.s2cells.update();
  };

  // rot and d2xy from Wikipedia
  window.plugin.s2cells.rot = function(n, x, y, rx, ry) {
    if(ry == 0) {
      if(rx == 1) {
        x = n-1 - x;
        y = n-1 - y;
      }

      return [y, x];
    }
    return [x, y];
  }
  window.plugin.s2cells.d2xy = function(n, d) {
    var rx, ry, s, t = d, xy = [0, 0];
    for(s=1; s<n; s*=2) {
      rx = 1 & (t/2);
      ry = 1 & (t ^ rx);
      xy = window.plugin.s2cells.rot(s, xy[0], xy[1], rx, ry);
      xy[0] += s * rx;
      xy[1] += s * ry;
      t /= 4;
    }
    return xy;
  };

  window.plugin.s2cells.update = function() {

    window.plugin.s2cells.regionLayer.clearLayers();

    var bounds = map.getBounds();

    var seenCells = {};

    var drawCellAndNeighbors = function(cell, color) {
      var cellStr = cell.toString();

      if (!seenCells[cellStr]) {
        // cell not visited - flag it as visited now
        seenCells[cellStr] = true;

        // is it on the screen?
        var corners = cell.getCornerLatLngs();
        var cellBounds = L.latLngBounds([corners[0],corners[1]]).extend(corners[2]).extend(corners[3]);

        if (cellBounds.intersects(bounds)) {
          // on screen - draw it
          window.plugin.s2cells.drawCell(cell, color);

          // and recurse to our neighbors
          var neighbors = cell.getNeighbors();
          for (var i=0; i<neighbors.length; i++) {
            drawCellAndNeighbors(neighbors[i], color);
          }
        }
      }

    };

    // centre cell
    var center = map.getCenter();
    var zoom = map.getZoom();

    if (zoom >= 19) {
      var cell = S2.S2Cell.FromLatLng ( center, 20 );

      drawCellAndNeighbors(cell, 'yellow');
    }

    if (zoom >= 16) {
      var cell = S2.S2Cell.FromLatLng ( center, 17 );

      drawCellAndNeighbors(cell, 'gold');
    }

    if (zoom >= 14) {
      var cell = S2.S2Cell.FromLatLng ( center, 14 );

      drawCellAndNeighbors(cell, 'red');
    }

    if (zoom >= 13) {
      var cell = S2.S2Cell.FromLatLng ( center, 13 );

      drawCellAndNeighbors(cell, 'blue');
    }


    // the six cube side boundaries. we cheat by hard-coding the coords as it's simple enough
    var latLngs = [ [45,-180], [35.264389682754654,-135], [35.264389682754654,-45], [35.264389682754654,45], [35.264389682754654,135], [45,180]];

    var globalCellOptions = {color: 'red', weight: 7, opacity: 0.5, clickable: false };

    for (var i=0; i<latLngs.length-1; i++) {
      // the geodesic line code can't handle a line/polyline spanning more than (or close to?) 180 degrees, so we draw
      // each segment as a separate line
      var poly1 = L.geodesicPolyline ( [latLngs[i], latLngs[i+1]], globalCellOptions );
      window.plugin.s2cells.regionLayer.addLayer(poly1);

      //southern mirror of the above
      var poly2 = L.geodesicPolyline ( [[-latLngs[i][0],latLngs[i][1]], [-latLngs[i+1][0], latLngs[i+1][1]]], globalCellOptions );
      window.plugin.s2cells.regionLayer.addLayer(poly2);
    }

    // and the north-south lines. no need for geodesic here
    for (var i=-135; i<=135; i+=90) {
      var poly = L.polyline ( [[35.264389682754654,i], [-35.264389682754654,i]], globalCellOptions );
      window.plugin.s2cells.regionLayer.addLayer(poly);
    }
  }

  window.plugin.s2cells.drawCell = function(cell, color) {

    //TODO: move to function - then call for all cells on screen

    // corner points
    var corners = cell.getCornerLatLngs();

    // center point
    var center = cell.getLatLng();

    // the level 6 cells have noticible errors with non-geodesic lines - and the larger level 4 cells are worse
    // NOTE: we only draw two of the edges. as we draw all cells on screen, the other two edges will either be drawn
    // from the other cell, or be off screen so we don't care
    var region = L.geodesicPolyline([corners[0],corners[1],corners[2]], {fill: false, color: color, opacity: 0.5, weight: 5*3/(cell.level-9), clickable: false });

    window.plugin.s2cells.regionLayer.addLayer(region);

    // move the label if we're at a high enough zoom level and it's off screen
    if (map.getZoom() >= 9) {
      var namebounds = map.getBounds().pad(-0.1); // pad 10% inside the screen bounds
      if (!namebounds.contains(center)) {
        // name is off-screen. pull it in so it's inside the bounds
        var newlat = Math.max(Math.min(center.lat, namebounds.getNorth()), namebounds.getSouth());
        var newlng = Math.max(Math.min(center.lng, namebounds.getEast()), namebounds.getWest());

        var newpos = L.latLng(newlat,newlng);

        // ensure the new position is still within the same cell
        var newposcell = S2.S2Cell.FromLatLng ( newpos, 6 );
        if ( newposcell.toString() == cell.toString() ) {
          center=newpos;
        }
        // else we leave the name where it was - offscreen
      }
    }
  };

  var setup =  window.plugin.s2cells.setup;

  // PLUGIN END //////////////////////////////////////////////////////////


  setup.info = plugin_info; //add the script info data to the function as a property
  if(!window.bootPlugins) window.bootPlugins = [];
  window.bootPlugins.push(setup);
  // if IITC has already booted, immediately run the 'setup' function
  if(window.iitcLoaded && typeof setup === 'function') setup();
} // wrapper end
// inject code into site context
var script = document.createElement('script');
var info = {};
if (typeof GM_info !== 'undefined' && GM_info && GM_info.script) info.script = { version: GM_info.script.version, name: GM_info.script.name, description: GM_info.script.description };
script.appendChild(document.createTextNode('('+ wrapper +')('+JSON.stringify(info)+');'));
(document.body || document.head || document.documentElement).appendChild(script);