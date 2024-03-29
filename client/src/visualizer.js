// vim:set ft=javascript ts=2 sw=2 sts=2 cindent:


var Visualizer = (function($, window, undefined) {
  
    var DocumentData = function(text) {
      this.text = text;
      this.chunks = [];
      this.spans = {};
      this.eventDescs = {};
      this.sentComment = {};
      this.markedSent = {};
      this.arcs = [];
      this.towers = {};
      this.arrows = {};
      this.spanAnnTexts = {};
      this.sentenceLinks = {};
      this.chunksByFrom = {};
      // this.sizes = {};
      // this.rows = [];
    }

    var Span = function(id, type, from, to, generalType) {
      this.id = id;
      this.type = type;
      this.from = parseInt(from);
      this.to = parseInt(to);
      this.totalDist = 0;
      this.numArcs = 0;
      this.generalType = generalType;
      // this.chunk = undefined;
      // this.marked = undefined;
      // this.avgDist = undefined;
      // this.curly = undefined;
      // this.comment = undefined; // { type: undefined, text: undefined };
      // this.annotatorNotes = undefined;
      // this.drawCurly = undefined;
      // this.glyphedLabelText = undefined;
      // this.group = undefined;
      // this.height = undefined;
      // this.highlightPos = undefined;
      // this.indexNumber = undefined;
      // this.labelText = undefined;
      // this.lineIndex = undefined;
      // this.nestingDepth = undefined;
      // this.nestingDepthLR = undefined;
      // this.nestingDepthRL = undefined;
      // this.nestingHeight = undefined;
      // this.nestingHeightLR = undefined;
      // this.nestingHeightRL = undefined;
      // this.rect = undefined;
      // this.box = undefined;
      // this.refedIndexSum = undefined;
      // this.right = undefined;
      // this.totaldist = undefined;
      // this.towerId = undefined;
      // this.width = undefined;
      this.initContainers();
    };

    Span.prototype.initContainers = function() {
      this.incoming = [];
      this.outgoing = [];
      this.attributes = {};
      this.attributeText = [];
      this.attributeCues = {};
      this.attributeCueFor = {};
      this.attributeMerge = {}; // for box, cross, etc. that are span-global
    };

    Span.prototype.copy = function(id) {
      var span = $.extend(new Span(), this); // clone
      span.id = id;
      span.initContainers(); // protect from shallow copy
      return span;
    };

    var EventDesc = function(id, triggerId, roles, klass) {
      this.id = id;
      this.triggerId = triggerId;
      var roleList = this.roles = [];
      $.each(roles, function(roleNo, role) {
        roleList.push({ type: role[0], targetId: role[1] });
      });
      if (klass == "equiv") {
        this.equiv = true;
      } else if (klass == "relation") {
        this.relation = true;
      }
      // this.leftSpans = undefined;
      // this.rightSpans = undefined;
      // this.annotatorNotes = undefined;
    };

    var Chunk = function(index, text, from, to, space, spans) {
      this.index = index;
      this.text = text;
      this.from = from;
      this.to = to;
      this.space = space;
      this.spans = [];
      // this.sentence = undefined;
      // this.group = undefined;
      // this.highlightGroup = undefined;
      // this.markedTextStart = undefined;
      // this.markedTextEnd = undefined;
      // this.nextSpace = undefined;
      // this.right = undefined;
      // this.row = undefined;
      // this.textX = undefined;
      // this.translation = undefined;
    }

    var Arc = function(eventDesc, role, dist, eventNo) {
      this.origin = eventDesc.id;
      this.target = role.targetId;
      this.dist = dist;
      this.type = role.type;
      this.shadowClass = eventDesc.shadowClass;
      this.jumpHeight = 0;
      if (eventDesc.equiv) {
        this.equiv = true;
        this.eventDescId = eventNo;
        eventDesc.equivArc = this;
      } else if (eventDesc.relation) {
        this.relation = true;
        this.eventDescId = eventNo;
      }
      // this.marked = undefined;
    };

    var Row = function(svg) {
      this.chunks = [];
      this.hasAnnotations = false;
      this.maxArcHeight = 0;
      this.maxSpanHeight = 0;
      this.lines = [];
      // this.group = undefined;
      // this.background = undefined;
      // this.index = undefined;
    };

    var Measurements = function(widths, height, y) {
      this.widths = widths;
      this.height = height;
      this.y = y;
    };

    var Visualizer = function(dispatcher, svgId) {
      var $svgDiv = $('#' + svgId);
      var that = this;

      // OPTIONS
      var roundCoordinates = true; // try to have exact pixel offsets
      var boxTextMargin = { x: 0, y: 1.5 }; // effect is inverse of "margin" for some reason
      var highlightRounding = { x: 3, y:3 }; // rx, ry for highlight boxes
      var spaceWidths = {
        ' ': 4,
        '\u00a0': 4,
        '\u200b': 0,
        '\u3000': 8,
        '\n': 4
      };
      var coloredCurlies = true; // color curlies by box BG
      var arcSlant = 15; //10;
      var minArcSlant = 8;
      var arcHorizontalSpacing = 10; // min space boxes with connecting arc
      var rowSpacing = -5;          // for some funny reason approx. -10 gives "tight" packing.
      var sentNumMargin = 20;
      var smoothArcCurves = true;   // whether to use curves (vs lines) in arcs
      var smoothArcSteepness = 0.5; // steepness of smooth curves (control point)
      var reverseArcControlx = 5;   // control point distance for "UFO catchers"
      
      // "shadow" effect settings (note, error, incompelete)
      var rectShadowSize = 3;
      var rectShadowRounding = 2.5;
      var arcLabelShadowSize = 1;
      var arcLabelShadowRounding = 5;
      var shadowStroke = 2.5; // TODO XXX: this doesn't affect anything..?

      // "marked" effect settings (edited, focus, match)
      var markedSpanSize = 6;
      var markedArcSize = 2;
      var markedArcStroke = 7; // TODO XXX: this doesn't seem to do anything..?

      var rowPadding = 2;
      var nestingAdjustYStepSize = 2; // size of height adjust for nested/nesting spans
      var nestingAdjustXStepSize = 1; // size of height adjust for nested/nesting spans

      var highlightSequence = '#FF9632;#FFCC00;#FF9632'; // yellow - deep orange
      //var highlightSequence = '#FFFC69;#FFCC00;#FFFC69'; // a bit toned town
      var highlightSpanSequence = highlightSequence;
      var highlightArcSequence =  highlightSequence;
      var highlightTextSequence = highlightSequence;
      var highlightDuration = '2s';
      // different sequence for "mere" matches (as opposed to "focus" and
      // "edited" highlights)
      var highlightMatchSequence = '#FFFF00'; // plain yellow
      
      // END OPTIONS


      var svg;
      var $svg;
      var data = null;
      var sourceData = null;
      var coll, doc, args;
      var spanTypes;
      var relationTypesHash;
      var isRenderRequested;
      var isCollectionLoaded = false;
      var areFontsLoaded = false;
      var entityAttributeTypes = null;
      var eventAttributeTypes = null;
      var spanTypes = null;
      var highlightGroup;

      var commentPrioLevels = ['Unconfirmed', 'Incomplete', 'Warning', 'Error', 'AnnotatorNotes'];

      this.arcDragOrigin = null; // TODO

      // due to silly Chrome bug, I have to make it pay attention
      var forceRedraw = function() {
        if (!$.browser.chrome) return; // not needed
        $svg.css('margin-bottom', 1);
        setTimeout(function() { $svg.css('margin-bottom', 0); }, 0);
      }

      var commentPriority = function(commentClass) {
        if (commentClass === undefined) return -1;
        var len = commentPrioLevels.length;
        for (var i = 0; i < len; i++) {
          if (commentClass.indexOf(commentPrioLevels[i]) != -1) return i;
        }
        return 0;
      };

      var clearSVG = function() {
        data = null;
        sourceData = null;
        svg.clear();
        $svgDiv.hide();
      };

      var setMarked = function(markedType, markedText) {
        $.each(args[markedType] || [], function(markedNo, marked) {
          if (marked[0] == 'sent') {
            data.markedSent[marked[1]] = true;
          } else if (marked[0] == 'equiv') { // [equiv, Equiv, T1]
            $.each(sourceData.equivs, function(equivNo, equiv) {
              if (equiv[1] == marked[1]) {
                var len = equiv.length;
                for (var i = 2; i < len; i++) {
                  if (equiv[i] == marked[2]) {
                    // found it
                    len -= 3;
                    for (var i = 1; i <= len; i++) {
                      var arc = data.eventDescs[equiv[0] + "*" + i].equivArc;
                      arc.marked = markedType;
                    }
                    return; // next equiv
                  }
                }
              }
            });
          } else if (marked.length == 2) {
            markedText.push([parseInt(marked[0], 10), parseInt(marked[1], 10), markedType]);
          } else {
            var span = data.spans[marked[0]];
            if (span) {
              if (marked.length == 3) { // arc
                $.each(span.outgoing, function(arcNo, arc) {
                  if (arc.target == marked[2] && arc.type == marked[1]) {
                    arc.marked = markedType;
                  }
                });
              } else { // span
                span.marked = markedType;
              }
            } else {
              var eventDesc = data.eventDescs[marked[0]];
              if (eventDesc) { // relation
                var relArc = eventDesc.roles[0];
                $.each(data.spans[eventDesc.triggerId].outgoing, function(arcNo, arc) {
                  if (arc.target == relArc.targetId && arc.type == relArc.type) {
                    arc.marked = markedType;
                  }
                });
              } else { // try for trigger
                $.each(data.eventDescs, function(eventDescNo, eventDesc) {
                  if (eventDesc.triggerId == marked[0]) {
                    data.spans[eventDesc.id].marked = markedType;
                  }
                });
              }
            }
          }
        });
      };

      var spanSortComparator = function(a, b) {
        // longer arc distances go last
        var tmp = a.avgDist - b.avgDist;
        if (tmp) {
          return tmp < 0 ? -1 : 1;
        }
        // spans with more arcs go last
        var tmp = a.numArcs - b.numArcs;
        if (tmp) {
          return tmp < 0 ? -1 : 1;
        }
        // compare the span widths,
        // put wider on bottom so they don't mess with arcs, or shorter
        // on bottom if there are no arcs.
        var ad = a.to - a.from;
        var bd = b.to - b.from;
        tmp = ad - bd;
        if(a.numArcs == 0 && b.numArcs == 0) {
          tmp = -tmp;
        } 
        if (tmp) {
          return tmp < 0 ? 1 : -1;
        }
        tmp = a.refedIndexSum - b.refedIndexSum;
        if (tmp) {
          return tmp < 0 ? -1 : 1;
        }
        // if no other criterion is found, sort by type to maintain
        // consistency
        // TODO: isn't there a cmp() in JS?
        if (a.type < b.type) {
          return -1;
        } else if (a.type > b.type) {
          return 1;
        }

        return 0;
      };


      var setData = function(_data) {
        sourceData = _data;
        data = new DocumentData(sourceData.text);

        // collect annotation data
        $.each(sourceData.entities, function(entityNo, entity) {
          var span =
              //      (id,        type,      from,      to,        generalType)
              new Span(entity[0], entity[1], entity[2], entity[3], 'entity');
          data.spans[entity[0]] = span;
        });
        var triggerHash = {};
        $.each(sourceData.triggers, function(triggerNo, trigger) {
          triggerHash[trigger[0]] =
              //       (id,         type,       from,       to,         generalType), eventList
              [new Span(trigger[0], trigger[1], trigger[2], trigger[3], 'trigger'), []];
        });
        $.each(sourceData.events, function(eventNo, eventRow) {
          var eventDesc = data.eventDescs[eventRow[0]] =
              //           (id,          triggerId,   roles,        klass)
              new EventDesc(eventRow[0], eventRow[1], eventRow[2]);
          var trigger = triggerHash[eventDesc.triggerId];
          var span = trigger[0].copy(eventDesc.id);
          trigger[1].push(span);
          data.spans[eventDesc.id] = span;
        });

        // XXX modifications: delete later
        $.each(sourceData.modifications, function(modNo, mod) {
          // mod: [id, spanId, modification]
          if (!data.spans[mod[2]]) {
            dispatcher.post('messages', [[['<strong>ERROR</strong><br/>Event ' + mod[2] + ' (referenced from modification ' + mod[0] + ') does not occur in document ' + doc + '<br/>(please correct the source data)', 'error', 5]]]);
            return;
          }
          data.spans[mod[2]][mod[1]] = true;
        });

        $.each(sourceData.equivs, function(equivNo, equiv) {
          // equiv: ['*', 'Equiv', spanId...]
          equiv[0] = "*" + equivNo;
          var equivSpans = equiv.slice(2);
          var okEquivSpans = [];
          // collect the equiv spans in an array
          $.each(equivSpans, function(equivSpanNo, equivSpan) {
            if (data.spans[equivSpan]) okEquivSpans.push(equivSpan);
            // TODO: #404, inform the user with a message?
          });
          // sort spans in the equiv by their midpoint
          okEquivSpans.sort(function(a, b) {
            var aSpan = data.spans[a];
            var bSpan = data.spans[b];
            var tmp = aSpan.from + aSpan.to - bSpan.from - bSpan.to;
            if (tmp) {
              return tmp < 0 ? -1 : 1;
            }
            return 0;
          });
          // generate the arcs
          var len = okEquivSpans.length;
          for (var i = 1; i < len; i++) {
            var eventDesc = data.eventDescs[equiv[0] + '*' + i] =
                //                   (id,          triggerId,           roles,                         klass)
                new EventDesc(okEquivSpans[i - 1], okEquivSpans[i - 1], [[equiv[1], okEquivSpans[i]]], 'equiv');
            eventDesc.leftSpans = okEquivSpans.slice(0, i);
            eventDesc.rightSpans = okEquivSpans.slice(i);
          }
        });
        $.each(sourceData.relations, function(relNo, rel) {
          data.eventDescs[rel[0]] =
              //           (id,     triggerId, roles,           klass)
              new EventDesc(rel[2], rel[2], [[rel[1], rel[3]]], 'relation');
        });

        // attributes
        $.each(sourceData.attributes, function(attrNo, attr) {
          // attr: [id, name, spanId, value, cueSpanId

          // TODO: might wish to check what's appropriate for the type
          // instead of using the first attribute def found
          var attrType = (eventAttributeTypes[attr[1]] || 
                          entityAttributeTypes[attr[1]]);
          var attrValue = attrType && attrType.values[attrType.bool || attr[3]];
          var span = data.spans[attr[2]];
          if (!span) {
            dispatcher.post('messages', [[['Annotation ' + attr[2] + ', referenced from attribute ' + attr[0] + ', does not exist.', 'error']]]);
            return;
          }
          var valText = (attrValue && attrValue.name) || attr[3];
          var attrText = attrType
            ? (attrType.bool ? attrType.name : (attrType.name + ': ' + valText))
            : (attr[3] == true ? attr[1] : attr[1] + ': ' + attr[3]);
          span.attributeText.push(attrText);
          span.attributes[attr[1]] = attr[3];
          if (attr[4]) { // cue
            span.attributeCues[attr[1]] = attr[4];
            var cueSpan = data.spans[attr[4]];
            cueSpan.attributeCueFor[data.spans[1]] = attr[2];
            cueSpan.cue = 'CUE'; // special css type
          }
          $.extend(span.attributeMerge, attrValue);
        });

        // comments
        $.each(sourceData.comments, function(commentNo, comment) {
          // comment: [entityId, type, text]
          
          // TODO error handling

          // sentence id: ['sent', sentId]
          if (comment[0] instanceof Array && comment[0][0] == 'sent') {
            // sentence comment
            var sent = comment[0][1];
            var text = comment[2];
            if (data.sentComment[sent]) {
              text = data.sentComment[sent].text + '<br/>' + text;
            }
            data.sentComment[sent] = { type: comment[1], text: text };
          } else {
            var id = comment[0];
            var trigger = triggerHash[id];
            var eventDesc = data.eventDescs[id];
            var commentEntities =
                trigger
                ? trigger[1] // trigger: [span, ...]
                : id in data.spans
                  ? [data.spans[id]] // span: [span]
                  : id in data.eventDescs
                    ? [data.eventDescs[id]] // arc: [eventDesc]
                    : [];
            $.each(commentEntities, function(entityId, entity) {
              // if duplicate comment for entity:
              // overwrite type, concatenate comment with a newline
              if (!entity.comment) {
                entity.comment = { type: comment[1], text: comment[2] };
              } else {
                entity.comment.type = comment[1];
                entity.comment.text += "\n" + comment[2];
              }
              // partially duplicate marking of annotator note comments
              if (comment[1] == "AnnotatorNotes") {
                entity.annotatorNotes = comment[2];
              }
              // prioritize type setting when multiple comments are present
              if (commentPriority(comment[1]) > commentPriority(entity.shadowClass)) {
                entity.shadowClass = comment[1];
              }
            });
          }
        });

        // prepare span boundaries for token containment testing
        var sortedSpans = [];
        $.each(data.spans, function(spanNo, span) {
          sortedSpans.push(span);
        });
        sortedSpans.sort(function(a, b) {
          var x = a.from;
          var y = b.from;
          if (x == y) {
            x = a.to;
            y = b.to;
          }
          return ((x < y) ? -1 : ((x > y) ? 1 : 0));
        });
        var currentSpanId = 0;
        var startSpanId = 0;
        var numSpans = sortedSpans.length;
        var lastTo = 0;
        var firstFrom = null;
        var chunkNo = 0;
        var space;
        var chunk = null;
        // token containment testing (chunk recognition)
        $.each(sourceData.token_offsets, function() {
          var from = this[0];
          var to = this[1];
          if (firstFrom === null) firstFrom = from;

          // Replaced for speedup; TODO check correctness
          // inSpan = false;
          // $.each(data.spans, function(spanNo, span) {
          //   if (span.from < to && to < span.to) {
          //     // it does; no word break
          //     inSpan = true;
          //     return false;
          //   }
          // });

          // Is the token end inside a span?
          if (startSpanId && to > sortedSpans[startSpanId - 1].to) {
            while (startSpanId < numSpans && to > sortedSpans[startSpanId].from) {
              startSpanId++;
            }
          }
          currentSpanId = startSpanId;
          while (currentSpanId < numSpans && to >= sortedSpans[currentSpanId].to) {
            currentSpanId++;
          }
          // if yes, the next token is in the same chunk
          if (currentSpanId < numSpans && to > sortedSpans[currentSpanId].from) {
            return;
          }

          // otherwise, create the chunk found so far
          space = data.text.substring(lastTo, firstFrom);
          var text = data.text.substring(firstFrom, to);
          if (chunk) chunk.nextSpace = space;
          //               (index,     text, from,      to, space) {
          chunk = new Chunk(chunkNo++, text, firstFrom, to, space);
          data.chunks.push(chunk);
          data.chunksByFrom[chunk.from] = chunk;
          lastTo = to;
          firstFrom = null;
        });
        var numChunks = chunkNo;

        // find sentence boundaries in relation to chunks
        chunkNo = 0;
        var sentenceNo = 0;
        var pastFirst = false;
        $.each(sourceData.sentence_offsets, function() {
          var from = this[0];
          var chunk;
          if (data.chunks[chunkNo].from > from) return;
          while (chunkNo < numChunks && (chunk = data.chunks[chunkNo]).from < from) {
            chunkNo++;
          }
          chunkNo++;
          if (pastFirst) {
            var numNL = chunk.space.split("\n").length - 1;
            if (!numNL) numNL = 1;
            sentenceNo += numNL;
            chunk.sentence = sentenceNo;
          } else {
            pastFirst = true;
          }
        }); // sentence_offsets

        // assign spans to appropriate chunks
        var numChunks = data.chunks.length;
        var currentChunkId = 0;
        var chunk;
        $.each(sortedSpans, function(spanId, span) {
          while (span.to > (chunk = data.chunks[currentChunkId]).to) currentChunkId++;
          chunk.spans.push(span);
          span.text = chunk.text.substring(span.from - chunk.from, span.to - chunk.from);
          span.chunk = chunk;
        });

        // assign arcs to spans; calculate arc distances
        $.each(data.eventDescs, function(eventNo, eventDesc) {
          var dist = 0;
          var origin = data.spans[eventDesc.id];
          if (!origin) {
            // TODO: include missing trigger ID in error message
            dispatcher.post('messages', [[['<strong>ERROR</strong><br/>Trigger for event "' + eventDesc.id + '" not found in ' + doc + '<br/>(please correct the source data)', 'error', 5]]]);
            return;
          }
          var here = origin.chunk.index;
          $.each(eventDesc.roles, function(roleNo, role) {
            var target = data.spans[role.targetId];
            if (!target) {
              dispatcher.post('messages', [[['<strong>ERROR</strong><br/>"' + role.targetId + '" (referenced from "' + eventDesc.id + '") not found in ' + data.document + '<br/>(please correct the source data)', 'error', 5]]]);
              return;
            }
            var there = target.chunk.index;
            var dist = Math.abs(here - there);
            var arc = new Arc(eventDesc, role, dist, eventNo);
            origin.totalDist += dist;
            origin.numArcs++;
            target.totalDist += dist;
            target.numArcs++;
            data.arcs.push(arc);
            target.incoming.push(arc);
            origin.outgoing.push(arc);
          }); // roles
        }); // eventDescs

        // highlighting
        var markedText = [];
        setMarked('edited', markedText); // set by editing process
        setMarked('focus', markedText); // set by URL
        setMarked('matchfocus', markedText); // set by search process, focused match
        setMarked('match', markedText); // set by search process, other (non-focused) match

        // resort the spans for linear order by center
        sortedSpans.sort(function(a, b) {
          var tmp = a.from + a.to - b.from - b.to;
          if (tmp) {
            return tmp < 0 ? -1 : 1;
          }
          return 0;
        });

        // sort spans into towers, calculate average arc distances
        var lastSpan = null;
        var towerId = -1;
        $.each(sortedSpans, function(i, span) {
          if (!lastSpan || (lastSpan.from != span.from || lastSpan.to != span.to)) {
            towerId++;
          }
          span.towerId = towerId;
          // average distance of arcs (0 for no arcs)
          span.avgDist = span.numArcs ? span.totalDist / span.numArcs : 0;
          lastSpan = span;
        }); // sortedSpans

        for (var i = 0; i < 2; i++) {
          // preliminary sort to assign heights for basic cases
          // (first round) and cases resolved in the previous
          // round(s).
          $.each(data.chunks, function(chunkNo, chunk) {
            // sort
            chunk.spans.sort(spanSortComparator);
            // renumber
            $.each(chunk.spans, function(spanNo, span) {
              span.indexNumber = spanNo;
              span.refedIndexSum = 0;
            });
          });
          // resolved cases will now have indexNumber set
          // to indicate their relative order. Sum those for referencing cases
          // for use in iterative resorting
          $.each(data.arcs, function(arcNo, arc) {
            data.spans[arc.origin].refedIndexSum += data.spans[arc.target].indexNumber;
          });
        }

        var spanAnnTexts = {};
        // Final sort of spans in chunks for drawing purposes
        // Also identify the marked text boundaries regarding chunks
        $.each(data.chunks, function(chunkNo, chunk) {
          // and make the next sort take this into account. Note that this will
          // now resolve first-order dependencies between sort orders but not
          // second-order or higher.
          chunk.spans.sort(spanSortComparator);

          chunk.markedTextStart = [];
          chunk.markedTextEnd = [];

          $.each(chunk.spans, function(spanNo, span) {
            if (!data.towers[span.towerId]) {
              data.towers[span.towerId] = [];
              span.drawCurly = true;
            }
            data.towers[span.towerId].push(span);

            var spanLabels = Util.getSpanLabels(spanTypes, span.type);
            span.labelText = Util.spanDisplayForm(spanTypes, span.type);
            // Find the most appropriate label according to text width
            if (Configuration.abbrevsOn && spanLabels) {
              var labelIdx = 1; // first abbrev
              var maxLength = (span.to - span.from) / 0.8;
              while (span.labelText.length > maxLength &&
                  spanLabels[labelIdx]) {
                span.labelText = spanLabels[labelIdx];
                labelIdx++;
              }
            }

            var svgtext = svg.createText(); // one "text" element per row
            var postfixArray = [];
            var prefix = '';
            var postfix = '';
            var warning = false;
            $.each(span.attributes, function(attrType, valType) {
              // TODO: might wish to check what's appropriate for the type
              // instead of using the first attribute def found
              var attr = (eventAttributeTypes[attrType] ||
                          entityAttributeTypes[attrType]);
              if (!attr) {
                // non-existent type
                warning = true;
                return;
              }
              var val = attr.values[attr.bool || valType];
              if (!val) {
                // non-existent value
                warning = true;
                return;
              }
              if ($.isEmptyObject(val)) {
                // defined, but lacks any visual presentation
                warning = true;
                return;
              }
              if (val.glyph) {
                if (val.position == "left") {
                  prefix = val.glyph + prefix;
                  var css = 'glyph';
                  if (attr.css) css += ' glyph_' + Util.escapeQuotes(attr.css);
                  svgtext.span(val.glyph, { 'class': css });
                } else { // XXX right is implied - maybe change
                  postfixArray.push([attr, val]);
                  postfix += val.glyph;
                }
              }
            });
            var text = span.labelText;
            if (prefix !== '') {
              text = prefix + ' ' + text;
              svgtext.string(' ');
            }
            svgtext.string(span.labelText);
            if (postfixArray.length) {
              text += ' ' + postfix;
              svgtext.string(' ');
              $.each(postfixArray, function(elNo, el) {
                var css = 'glyph';
                if (el[0].css) css += ' glyph_' + Util.escapeQuotes(el[0].css);
                svgtext.span(el[1].glyph, { 'class': css });
              });
            }
            if (warning) {
              svgtext.span("#", { 'class': 'glyph attribute_warning' });
              text += ' #';
            }
            span.glyphedLabelText = text;

            if (!spanAnnTexts[text]) {
              spanAnnTexts[text] = true;
              data.spanAnnTexts[text] = svgtext;
            }
          }); // chunk.spans
        }); // chunks

        var numChunks = data.chunks.length;
        // note the location of marked text with respect to chunks
        var startChunk = 0;
        var currentChunk;
        // sort by "from"; we don't need to sort by "to" as well,
        // because unlike spans, chunks are disjunct
        markedText.sort(function(a, b) { 
          return Util.cmp(a[0], b[0]);
        });
        $.each(markedText, function(textNo, textPos) {
          var from = textPos[0];
          var to = textPos[1];
          var markedType = textPos[2];
          if (from < 0) from = 0;
          if (to < 0) to = 0;
          if (to >= data.text.length) to = data.text.length - 1;
          if (from > to) from = to;
          while (startChunk < numChunks) {
            var chunk = data.chunks[startChunk];
            if (from <= chunk.to) {
              chunk.markedTextStart.push([textNo, true, from - chunk.from, null, markedType]);
              break;
            }
            startChunk++;
          }
          if (startChunk == numChunks) {
            dispatcher.post('messages', [[['Wrong text offset', 'error']]]);
            return;
          }
          currentChunk = startChunk;
          while (currentChunk < numChunks) {
            var chunk = data.chunks[currentChunk];
            if (to <= chunk.to) {
              chunk.markedTextEnd.push([textNo, false, to - chunk.from]);
              break
            }
            currentChunk++;
          }
          if (currentChunk == numChunks) {
            dispatcher.post('messages', [[['Wrong text offset', 'error']]]);
            var chunk = data.chunks[data.chunks.length - 1];
            chunk.markedTextEnd.push([textNo, false, chunk.text.length]);
            return;
          }
        }); // markedText

        // TODO: can span.lineIndex be different from span.towerId?
        // If not, this piece of code should replace the towerId piece above
        var realSpanNo = -1;
        var lastSpan;
        $.each(sortedSpans, function(spanNo, span) {
          if (!lastSpan || span.from != lastSpan.from || span.to != lastSpan.to) realSpanNo++;
          span.lineIndex = realSpanNo;
          if (span.chunk.firstSpanIndex == undefined) span.chunk.firstSpanIndex = realSpanNo;
          span.chunk.lastSpanIndex = realSpanNo;
          lastSpan = span;
        });
        dispatcher.post('dataReady', [data]);
      };

      var resetData = function() {
        setData(data);
        renderData();
      }

      var placeReservation = function(span, x, width, height, reservations) {
        var newSlot = {
          from: x,
          to: x + width,
          span: span,
          height: height + (span.drawCurly ? Configuration.visual.curlyHeight : 0),
        };
        // TODO look at this, and remove if ugly
        // example where it matters: the degenerate case of
        // <REDACTED> look at @14ab7a68cb592821b8d3341957b8dfaa24540e22 for URL
        // (again, it would be solved by individual box reservations instead
        // of row-based)

        // overlapping curly check: TODO delete or uncomment
        /*
        if (span.drawCurly) {
          if (span.curly.from < newSlot.from) newSlot.from = span.curly.from;
          if (span.curly.to > newSlot.to) newSlot.to = span.curly.to;
        }
        */
        var resHeight = 0;
        if (reservations.length) {
          for (var resNo = 0, resLen = reservations.length; resNo < resLen; resNo++) {
            var reservation = reservations[resNo];
            var line = reservation.ranges;
            resHeight = reservation.height;
            var overlap = false;
            $.each(line, function(slotNo, slot) {
              var slot = line[slotNo];
              // with the curly change above, we can live with sharing
              // borders
              if (slot.from < newSlot.to && newSlot.from < slot.to) {
                overlap = true;
                return false;
              }
            });
            if (!overlap) {
              if (!reservation.curly && span.drawCurly) {
                // TODO: need to push up the boxes drawn so far
                // (rare glitch)
                // it would be prettier to track individual boxes (and not
                // rows) but the cases when it matters are rare, and not
                // worth the bother so far
                reservation.height += Configuration.visual.curlyHeight;
              }
              line.push(newSlot);
              return reservation.height;
            }
          }
          resHeight += newSlot.height + Configuration.visual.boxSpacing;
        }
        reservations.push({
          ranges: [newSlot],
          height: resHeight,
          curly: span.drawCurly,
        });
        return resHeight;
      };

      var translate = function(element, x, y) {
        $(element.group).attr('transform', 'translate(' + x + ', ' + y + ')');
        element.translation = { x: x, y: y };
      };

      var showMtime = function() {
        if (data.mtime) {
            // we're getting seconds and need milliseconds
            //$('#document_ctime').text("Created: " + Annotator.formatTime(1000 * data.ctime)).css("display", "inline");
            $('#document_mtime').text("Last modified: " + Util.formatTimeAgo(1000 * data.mtime)).css("display", "inline");
        } else {
            //$('#document_ctime').css("display", "none");
            $('#document_mtime').css("display", "none");
        }
      };
      
      var getTextMeasurements = function(textsHash, options, callback) {
        // make some text elements, find out the dimensions
        var textMeasureGroup = svg.group(options);

        // changed from $.each because of #264 ('length' can appear)
        for (var text in textsHash) {
          if (textsHash.hasOwnProperty(text)) {
            svg.text(textMeasureGroup, 0, 0, text);
          }
        }

        // measuring goes on here
        var widths = {};
        $(textMeasureGroup).find('text').each(function(svgTextNo, svgText) {
          var text = $(svgText).text();
          widths[text] = this.getComputedTextLength();

          if (callback) {
            $.each(textsHash[text], function(text, object) {
              callback(object, svgText);
            });
          }
        });
        var bbox = textMeasureGroup.getBBox();
        svg.remove(textMeasureGroup);

        return new Measurements(widths, bbox.height, bbox.y);
      };

      var getTextAndSpanTextMeasurements = function() {
        // get the span text sizes
        var chunkTexts = {}; // set of span texts
        $.each(data.chunks, function(chunkNo, chunk) {
          chunk.row = undefined; // reset
          if (!(chunk.text in chunkTexts)) chunkTexts[chunk.text] = []
          var chunkText = chunkTexts[chunk.text];

          // here we also need all the spans that are contained in
          // chunks with this text, because we need to know the position
          // of the span text within the respective chunk text
          chunkText.push.apply(chunkText, chunk.spans);
          // and also the markedText boundaries
          chunkText.push.apply(chunkText, chunk.markedTextStart);
          chunkText.push.apply(chunkText, chunk.markedTextEnd);
        });
        var textSizes = getTextMeasurements(
          chunkTexts,
          undefined,
          function(span, text) {
            if (span.text !== undefined) { // it's a span!
              // measure the span text position in pixels
              var firstChar = span.from - span.chunk.from;
              if (firstChar < 0) {
                firstChar = 0;
                dispatcher.post('messages', [[['<strong>WARNING</strong>' +
                  '<br/> ' +
                  'The span [' + span.from + ', ' + span.to + '] (' + span.text + ') is not ' +
                  'contained in its designated chunk [' +
                  span.chunk.from + ', ' + span.chunk.to + '] most likely ' +
                  'due to the span starting or ending with a space, please ' +
                  'verify the sanity of your data since we are unable to ' +
                  'visualise this span correctly and will drop leading ' +
                  'space characters'
                  , 'warning', 15]]]);
              }
              var startPos = text.getStartPositionOfChar(firstChar).x;
              var lastChar = span.to - span.chunk.from - 1;
              var endPos = (lastChar < 0)
                ? startPos
                : text.getEndPositionOfChar(lastChar).x;
              span.curly = {
                from: startPos,
                to: endPos
              };
            } else { // it's markedText [id, start?, char#, offset]
              if (span[2] < 0) span[2] = 0;
              if (!span[2]) { // start
                span[3] = text.getStartPositionOfChar(span[2]).x;
              } else {
                span[3] = text.getEndPositionOfChar(span[2] - 1).x + 1;
              }
            }
          });

        // get the span annotation text sizes
        var spanTexts = {};
        var noSpans = true;
        $.each(data.spans, function(spanNo, span) {
          spanTexts[span.glyphedLabelText] = true;
          noSpans = false;
        });
        var spanSizes = getTextMeasurements(spanTexts, {'class': 'span'});
        if (noSpans) spanTexts.$ = true; // dummy so we can at least get the height

        var sentNoTexts = {};
        sentNoTexts[sourceData.sentence_offsets.length] = true;
        $.each(data.sentComment, function(sentCommentNo, sentComment) {
          sentNoTexts[sentCommentNo + 1] = true;
        });
        var sentNoSizes = getTextMeasurements(sentNoTexts, {'class': 'sentNum'});

        return {
          texts: textSizes,
          spans: spanSizes,
          sentNos: sentNoSizes
        };
      };

      var addArcTextMeasurements = function(sizes) {
        // get the arc annotation text sizes (for all labels)
        var arcTexts = {};
        $.each(data.arcs, function(arcNo, arc) {
          var labels = Util.getArcLabels(spanTypes, data.spans[arc.origin].type, arc.type);
          if (!labels.length) labels = [arc.type];
          $.each(labels, function(labelNo, label) {
            arcTexts[label] = true;
          });
        });
        var arcSizes = getTextMeasurements(arcTexts, {'class': 'arcs'});
        sizes.arcs = arcSizes;
      };

      var adjustTowerAnnotationSizes = function() {
        // find biggest annotation in each tower
        $.each(data.towers, function(towerNo, tower) {
          var maxWidth = 0;
          $.each(tower, function(spanNo, span) {
            var width = data.sizes.spans.widths[span.glyphedLabelText];
            if (width > maxWidth) maxWidth = width;
          }); // tower
          $.each(tower, function(spanNo, span) {
            span.width = maxWidth;
          }); // tower
        }); // data.towers
      };

      var makeArrow = function(spec) {
        var parsedSpec = spec.split(',');
        var type = parsedSpec[0];
        if (type == 'none') return;

        var size = parsedSpec[1];
        var color = parsedSpec[2];
        if (!color) {
          color = size;
          size = 5;
        }
        var arrowId = 'arrow_' + spec.replace(/,/g, '_');
        data.arrows[spec] = [type, size, color, arrowId];

        return arrowId;
      }

      var transition = function(element, attr, oldVal, newVal) {
        if (oldVal != newVal) {
          svg.other(element, 'animate', {
            attributeName: attr,
            from: oldVal,
            to: newVal,
            dur: '1s',
            begin: 'indefinite',
            fill: 'freeze'
          });
        }
      };

      var addElementsToSVG = function(reuse) {
        // prologue, defs, drag arrow
        if (!reuse) {
          var commentName = (coll + '/' + doc).replace('--', '-\\-');
          $svg.append('<!-- document: ' + commentName + ' -->');
          var defs = svg.defs();
          var $blurFilter = $('<filter id="Gaussian_Blur"><feGaussianBlur in="SourceGraphic" stdDeviation="2" /></filter>');
          svg.add(defs, $blurFilter);

          var backgroundGroup = svg.group({ 'class': 'background' });
          // draw the drag arc marker
          var arrowhead = svg.marker(defs, 'drag_arrow',
            5, 2.5, 5, 5, 'auto',
            {
              markerUnits: 'strokeWidth',
              'class': 'drag_fill',
          });
          svg.polyline(arrowhead, [[0, 0], [5, 2.5], [0, 5], [0.2, 2.5]]);
        } else {
          var defs = $svg.find('defs');
          var backgroundGroup = $svg.find('.background');
          var trash = [];
          var additions = [];
        }

        // arc arrows
        var reuseArrows = reuse && reuse.arrows || {};
        $.each(data.arrows, function(arrowSpec, arrowDesc) {
          if (!(arrowSpec in reuseArrows)) {
            var size = arrowDesc[1];
            if (arrowDesc[0] == 'triangle') {
              var arrow = svg.marker(defs, arrowDesc[3],
                size, size / 2, size, size, 'auto',
                {
                  markerUnits: 'strokeWidth',
                  'fill': arrowDesc[2],
                });
              svg.polyline(arrow, [[0, 0], [size, size / 2], [0, size], [size / 25, size / 2]]);
            }
          }
        });
        // remove unused arrows, if any
        $.each(reuseArrows, function(arrowSpec, arrowDesc) {
          if (!(arrowSpec in data.arrows)) {
            $('#' + arrowDesc[3]).remove();
          }
        });

        if (reuse) {
          var glowGroup = $svg.find('g.glow');
          highlightGroup = $svg.find('g.highlight');
          var textGroup = $svg.find('g.text');
          var sentNumGroup = $svg.find('g.sentnum');
        } else {
          var glowGroup = svg.group({ 'class': 'glow' });
          highlightGroup = svg.group({ 'class': 'highlight' });
          var textGroup = svg.group({ 'class': 'text' });
          var sentNumGroup = svg.group({'class': 'sentnum'});
        }

        // sentence links
        $.each(data.sentenceLinks, function(sentNo, sentDesc) {
          var reuseDesc = reuse && reuse.sentenceLinks[sentNo];
          if (!reuseDesc || reuseDesc.x != sentDesc.x || reuseDesc.y != sentDesc.y) {
            sentDesc.link = svg.link(sentNumGroup, this.link);
          } else {
            sentDesc.link = reuseDesc.link;
          }

          var x = sentNumMargin - Configuration.visual.margin.x;

          if (this.sentComment) {
            var boxX = x - data.sizes.sentNos.widths[this.sentence];
            var boxY = this.textY - data.sizes.sentNos.height;
            // TODO: using rectShadowSize, but this shadow should
            // probably have its own setting for shadow size
            shadowRect = svg.rect(link,
              boxX - rectShadowSize, boxY - rectShadowSize,
              data.sizes.sentNos.widths[this.sentence] + 2 * rectShadowSize,
              data.sizes.sentNos.height + 2 * rectShadowSize, {
                'class': 'shadow_' + this.sentComment.type,
                filter: 'url(#Gaussian_Blur)',
                rx: rectShadowRounding,
                ry: rectShadowRounding,
                'data-sent': this.sentence,
            });
          }

          if (reuseDesc) {
            sentDesc.text = reuseDesc.text;
            transition(sentDesc.text, 'x', reuseDesc.x, sentDesc.x);
            transition(sentDesc.text, 'y', reuseDesc.y, sentDesc.y);
          } else {
            sentDesc.text = svg.text(sentDesc.link,
              sentDesc.x, sentDesc.y,
              '' + sentNo, { 'data-sent': sentNo });
            if (reuse) {
              transition(sentDesc.text, 'y', data.canvasHeight, sentDesc.y);
            }
          }
        });
        if (reuse) {
          for (var sentNo in reuse.sentenceLinks) {
            if (reuse.sentenceLinks.hasOwnProperty(sentNo) && !(sentNo in data.sentenceLinks)) {
              var sentDesc = reuse.sentenceLinks[sentNo];
              transition(sentDesc.link, 'y', reuse.y, data.canvasHeight);
              trash.push(sentDesc.link);
            }
          }
        }

        var reuseRowsNum = reuse && reuse.rows.length || 0;
        if (reuse) {
          var lastRow = reuse.rows[reuse.rows.length - 1];
          var lastY = lastRow.yf + lastRow.hf;
        }
        $.each(data.rows, function(rowId, row) {
          if (rowId < reuseRowsNum) {
            var reuseRow = reuse.rows[rowId];
            this.group = reuseRow.group;
            this.background = reuseRow.background;
            this.arcsGroup = reuseRow.arcsGroup;
          } else {
            var reuseRow = null;
            this.group = svg.group();
            this.background = svg.group(this.group);
            this.arcsGroup = svg.group(this.group, { 'class': 'arcs' });
          }

          this.yf = this.y + data.sizes.texts.y + data.sizes.texts.height;
          this.hf = this.height + data.sizes.texts.height + 1;
          if (reuseRow) {
            // move
            this.rowRect = reuseRow.rowRect;
            $(this.rowRect).attr('class', this.bgClass);
            transition(this.rowRect, 'width', reuse.canvasWidth, canvasWidth);
            transition(this.rowRect, 'y', reuseRow.yf, this.yf);
            transition(this.rowRect, 'height', reuseRow.hf, this.hf);
          } else {
            // apparate
            this.rowRect = svg.rect(backgroundGroup,
              0, this.yf, canvasWidth, this.hf, {
              'class': this.bgClass,
            });
            if (reuse) {
              transition(this.rowRect, 'y', lastY, this.yf);
              transition(this.rowRect, 'height', 0, this.hf);
            }
          }

          if (this.text) {
            if (reuseRow) {
              textGroup.find('text').remove();
            }
            // TODO instead of (0,0) and y coordinate inside the text,
            // put the y coordinate out here
            var text = svg.text(textGroup, 0, 0, this.text);
          }
        }); // rows

        var lastRow = data.rows[data.rows.length - 1];
        var lastY = lastRow.yf + lastRow.hf;
        for (var i = data.rows.length; i < reuseRowsNum; i++) {
          var reuseRow = reuse.rows[i];
          // disapparate
          transition(reuseRow.rowRect, 'height', reuseRow.height, 0);
          transition(reuseRow.rowRect, 'y', reuseRow.y, lastY);
          trash.push(reuseRow.group); // includes: spans, arcs
        }

        // chunk groups
        $.each(data.chunks, function() {
          var reuseChunk = reuse && reuse.chunksByFrom[this.from];
          if (reuseChunk && reuseChunk.to != this.to) reuseChunk = null;

          if (reuseChunk) {
            this.group = reuseChunk.group;
            this.highlightGroup = reuseChunk.highlightGroup;
          } else {
            this.group = svg.group(this.row.group);
            this.highlightGroup = svg.group(this.group);
          }
        }); // chunks
        if (reuse) {
          $.each(reuse.chunks, function() {
            var dataChunk = data.chunksByFrom[this.from];
            if (!dataChunk || dataChunk.to != this.to) {
              trash.push(this.group); // includes span.group
              trash.push(this.highlightGroup);
            };
          });
        }

        // spans
        $.each(data.spans, function() {
          var span = this;
          var reuseSpan = reuse && reuse.spans[this.id];

          if (reuseSpan) {
            this.group = reuseSpan.group;
            // TODO currently chunks are all split up.
            // remove the chunk groups,
            // we don't need them any more.
            // just make sure things bear proper attributes so we can
            // still react to events.
            // chunks themselves are still a useful concept for the
            // purpose of calculation - just remove the groups.
          } else {
            this.group = svg.group(this.chunk.group, {
              'class': 'span',
            });
          }

          var box = this.box;
          var plainbox = this.plainbox;
          if (this.marked) {
            if (reuseSpan && reuseSpan.markedRect) {
              // move
              this.markedRect = reuseSpan.markedRect;
              transition(this.markedRect, 'x', reuseSpan.box.x - markedSpanSize, box.x - markedSpanSize);
              transition(this.markedRect, 'y', reuseSpan.box.y - markedSpanSize, box.y - markedSpanSize);
              transition(this.markedRect, 'width', reuseSpan.box.w + 2 * markedSpanSize, box.w + 2 * markedSpanSize);
              transition(this.markedRect, 'height', reuseSpan.box.h + 2 * markedSpanSize, box.h + 2 * markedSpanSize);
            } else {
              // apparate
              this.markedRect = svg.rect(this.chunk.highlightGroup,
                box.x - markedSpanSize, box.y - markedSpanSize,
                box.w + 2 * markedSpanSize, box.h + 2 * markedSpanSize,
                {
                  // filter: 'url(#Gaussian_Blur)',
                  'class': "shadow_EditHighlight",
                  rx: markedSpanSize,
                  ry: markedSpanSize,
              });
              svg.other(this.markedRect, 'animate', {
                'data-type': this.marked,
                attributeName: 'fill',
                values: (this.marked == 'match'
                         ? highlightMatchSequence
                         : highlightSpanSequence),
                dur: highlightDuration,
                repeatCount: 'indefinite',
                begin: 'indefinite',
              });
              if (reuse) {
                transition(this.markedRect, 'x', box.x + box.w / 2, box.x - markedSpanSize);
                transition(this.markedRect, 'y', box.y + box.h / 2, box.y - markedSpanSize);
                transition(this.markedRect, 'width', 0, box.w + 2 * markedSpanSize);
                transition(this.markedRect, 'height', 0, box.h + 2 * markedSpanSize);
              }
            }
          } else if (reuseSpan && reuseSpan.markedRect) {
            // disapparate
            // XXX buggy?
            transition(reuseSpan.markedRect, 'x', reuseSpan.box.x - markedSpanSize, reuseSpan.box.x + reuseSpan.box.w / 2);
            transition(reuseSpan.markedRect, 'y', reuseSpan.box.y - markedSpanSize, reuseSpan.box.y + reuseSpan.box.h / 2);
            transition(reuseSpan.markedRect, 'width', reuseSpan.box.w + 2 * markedSpanSize, 0);
            transition(reuseSpan.markedRect, 'height', reuseSpan.box.h + 2 * markedSpanSize, 0);
            trash.push(reuseSpan.markedRect);
          }

          if (this.shadowClass) {
            if (reuseSpan && reuseSpan.shadowRect) {
              // move
              this.shadowRect = reuseSpan.shadowRect;
              transition(this.shadowRect, 'x', reuseSpan.box.x - rectShadowSize, box.x - rectShadowSize);
              transition(this.shadowRect, 'y', reuseSpan.box.y - rectShadowSize, box.y - rectShadowSize);
              transition(this.shadowRect, 'width', reuseSpan.box.w + 2 * rectShadowSize, box.w + 2 * rectShadowSize);
              transition(this.shadowRect, 'height', reuseSpan.box.h + 2 * rectShadowSize, box.h + 2 * rectShadowSize);
            } else {
              // apparate
              this.shadowRect = svg.rect(this.group,
                box.x - rectShadowSize, box.y - rectShadowSize,
                box.w + 2 * rectShadowSize, box.h + 2 * rectShadowSize,
                {
                  'class': 'shadow_' + this.shadowClass,
                  filter: 'url(#Gaussian_Blur)',
                  rx: rectShadowRounding,
                  ry: rectShadowRounding,
              });
              if (reuse) {
                transition(this.shadowRect, 'x', box.x + box.w / 2, box.x - rectShadowSize);
                transition(this.shadowRect, 'y', box.y + box.h / 2, box.y - rectShadowSize);
                transition(this.shadowRect, 'width', 0, box.w + 2 * rectShadowSize);
                transition(this.shadowRect, 'height', 0, box.h + 2 * rectShadowSize);
              }
            }
          } else if (reuseSpan && reuseSpan.markedRect) {
            // disapparate
            // XXX buggy?
            transition(reuseSpan.shadowRect, 'x', reuseSpan.box.x - rectShadowSize, reuseSpan.box.x + reuseSpan.box.w / 2);
            transition(reuseSpan.shadowRect, 'y', reuseSpan.box.y - rectShadowSize, reuseSpan.box.y + reuseSpan.box.h / 2);
            transition(reuseSpan.shadowRect, 'width', reuseSpan.box.w + 2 * rectShadowSize, 0);
            transition(reuseSpan.shadowRect, 'height', reuseSpan.box.h + 2 * rectShadowSize, 0);
            trash.push(reuseSpan.shadowRect);
          }

          if (reuseSpan) {
            // move
            this.rect = reuseSpan.rect;
            transition(this.rect, 'x', reuseSpan.box.x, box.x);
            transition(this.rect, 'y', reuseSpan.box.y, box.y);
            transition(this.rect, 'width', reuseSpan.box.w, box.w);
            transition(this.rect, 'height', reuseSpan.box.h, box.h);
          } else {
            // apparate
            this.rect = svg.rect(this.group,
              box.x, box.y, box.w, box.h, box.opts);
            if (reuse) {
              transition(this.rect, 'x', box.x + box.w / 2, box.x);
              transition(this.rect, 'y', box.y + box.h / 2, box.y);
              transition(this.rect, 'width', 0, box.w);
              transition(this.rect, 'height', 0, box.h);
            }
          }

          if (reuseSpan && reuseSpan.attributeMerge.box === "crossed") {
            // disapparate
            // can't animate it, so kill it now
            $.each(reuseSpan.cross, function() {
              $(this).remove();
            });
          }
          if (this.attributeMerge.box === "crossed") {
            // apparate
            // can't animate it, so defer drawing
            var renderCross = function() {
              var cross1 = svg.path(span.group, svg.createPath().
                  move(plainbox.x, plainbox.y - Configuration.visual.margin.y - span.yAdjust).
                  line(plainbox.x + span.width,
                    plainbox.y + plainbox.h + Configuration.visual.margin.y - span.yAdjust),
                  { 'class': 'boxcross' });
              var cross2 = svg.path(span.group, svg.createPath().
                  move(plainbox.x + span.width, plainbox.y - Configuration.visual.margin.y - span.yAdjust).
                  line(plainbox.x, plainbox.y + plainbox.h + Configuration.visual.margin.y - span.yAdjust),
                { 'class': 'boxcross' });
              span.cross = [cross1, cross2];
            }
            if (reuseSpan) additions.push(renderCross);
            else renderCross();
          }

          if (reuseSpan && reuseSpan.glyphedLabelText == this.glyphedLabelText) {
            // move
            this.text = reuseSpan.rect;
            transition(this.text, 'x', reuseSpan.curly.x, this.curly.x);
            transition(this.text, 'y', reuseSpan.textY, this.textY);
          } else {
            // apparate
            var drawText = function() {
              svg.text(span.group,
                span.curly.x, span.textY,
                data.spanAnnTexts[span.glyphedLabelText],
                { fill: span.fgColor }
              );
            };
            if (reuseSpan) additions.push(drawText);
            else drawText();
          }

          if (reuseSpan && reuseSpan.drawCurly) {
            // disapparate
            $(reuseSpan.curlyPath).remove();
          }
          if (this.drawCurly) {
            // apparate
            var bottom = plainbox.y + plainbox.h + Configuration.visual.margin.y - this.yAdjust + 1;
            var drawCurly = function() {
              span.curlyPath = svg.path(span.group, svg.createPath()
                  .move(span.curly.from, bottom + Configuration.visual.curlyHeight)
                  .curveC(span.curly.from, bottom,
                    span.curly.x, bottom + Configuration.visual.curlyHeight,
                    span.curly.x, bottom)
                  .curveC(span.curly.x, bottom + Configuration.visual.curlyHeight,
                    span.curly.to, bottom,
                    span.curly.to, bottom + Configuration.visual.curlyHeight),
                {
                  'class': 'curly',
                  'stroke': span.curly.color,
                });
            };
            if (reuseSpan) additions.push(drawCurly);
            else drawCurly();
          }

          if (reuseSpan) {
            // move
            this.highlightRect = reuseSpan.highlightRect;
            transition(this.highlightRect, 'x', reuseSpan.highlightPos.x, this.highlightPos.x);
            transition(this.highlightRect, 'y', reuseSpan.highlightPos.y, this.highlightPos.y);
            transition(this.highlightRect, 'width', reuseSpan.highlightPos.w, this.highlightPos.w);
            transition(this.highlightRect, 'height', reuseSpan.highlightPos.h, this.highlightPos.h);
          } else {
            // apparate
            this.highlightRect = svg.rect(highlightGroup,
                this.highlightPos.x, this.highlightPos.y,
                this.highlightPos.w, this.highlightPos.h,
                { fill: this.lightBgColor, //opacity:1,
                  rx: highlightRounding.x,
                  ry: highlightRounding.y,
                });
            if (reuse) {
              transition(this.highlightRect, 'x', this.highlightPos.x + this.highlightPos.w / 2, this.highlightPos.x);
              transition(this.highlightRect, 'y', this.highlightPos.y + this.highlightPos.h / 2, this.highlightPos.y);
              transition(this.highlightRect, 'width', 0, this.highlightPos.w);
              transition(this.highlightRect, 'height', 0, this.highlightPos.h);
            }
          }
        });

        // guess at the correct baseline shift to get vertical centering.
        // (CSS dominant-baseline can't be used as not all SVG renderers support it.)
        var baselineShift = data.sizes.arcs.height / 4;

        $.each(data.rows, function() {
          var row = this;

          $.each(this.lines, function() {
            var arc = this.arc;
            var textBox = this.textBox;

            var arcGroup = svg.group(row.arcsGroup, {
                'data-from': arc.origin,
                'data-to': arc.target
            });
            var shadowGroup;
            if (arc.shadowClass || arc.marked) {
              shadowGroup = svg.group(arcGroup);
            }
            svg.text(arcGroup, (this.from + this.to) / 2, this.height + baselineShift,
                                this.svgText, this.options);

            if (arc.marked) {
              var markedRect = svg.rect(shadowGroup,
                  textBox.x - markedArcSize, textBox.y - markedArcSize,
                  textBox.width + 2 * markedArcSize, textBox.height + 2 * markedArcSize, {
                    // filter: 'url(#Gaussian_Blur)',
                    'class': "shadow_EditHighlight",
                    rx: markedArcSize,
                    ry: markedArcSize,
              });
              svg.other(markedRect, 'animate', {
                'data-type': arc.marked,
                attributeName: 'fill',
                values: (arc.marked == 'match' ? highlightMatchSequence
                         : highlightArcSequence),
                dur: highlightDuration,
                repeatCount: 'indefinite',
                begin: 'indefinite'
              });
            }
            if (arc.shadowClass) {
              svg.rect(shadowGroup,
                  textBox.x - arcLabelShadowSize, 
                  textBox.y - arcLabelShadowSize,
                  textBox.width  + 2 * arcLabelShadowSize, 
                  textBox.height + 2 * arcLabelShadowSize, {
                    'class': 'shadow_' + arc.shadowClass,
                    filter: 'url(#Gaussian_Blur)',
                    rx: arcLabelShadowRounding,
                    ry: arcLabelShadowRounding,
              });
            }

            var lineData = this;
            $.each(this.sides, function() {
              var path = svg.createPath().move(this.x0, lineData.height);
              if (this.edgeRow) {
                if (smoothArcCurves) {
                  path.line(this.x1, lineData.height).
                      curveQ(this.x2, lineData.height, this.x3, this.y3);
                } else {
                  path.line(this.x1, lineData.height).
                      line(this.x3, this.y3);
                }
              } else {
                path.line(this.x3, lineData.height);
              }

              svg.path(arcGroup, path, {
                markerEnd: this.arrow && ('url(#' + this.arrow + ')'),
                style: 'stroke: ' + lineData.color,
                'strokeDashArray': lineData.dashArray,
              });
              if (arc.marked) {
                var markedPath = svg.path(shadowGroup, path, {
                    'class': 'shadow_EditHighlight_arc',
                    strokeWidth: markedArcStroke,
                    'strokeDashArray': lineData.dashArray,
                });
                svg.other(markedPath, 'animate', {
                  'data-type': arc.marked,
                  attributeName: 'fill',
                  values: (arc.marked == 'match' ? highlightMatchSequence
                           : highlightArcSequence),
                  dur: highlightDuration,
                  repeatCount: 'indefinite',
                  begin: 'indefinite'
                });
              }
              if (arc.shadowClass) {
                svg.path(shadowGroup, path, {
                    'class': 'shadow_' + arc.shadowClass,
                    strokeWidth: shadowStroke,
                    'strokeDashArray': lineData.dashArray,
                });
              }
            }); // sides
          }); // lines
        }); // rows

        $.each(data.textHighlights, function() {
          var highlightRect = svg.rect(highlightGroup,
            this.x, this.y, this.w, this.h,
            { fill: 'yellow' } // TODO: put into css file, as default - turn into class
          );
          // NOTE: changing highlightTextSequence here will give
          // different-colored highlights
          // TODO: entirely different settings for non-animations?
          svg.other(highlightRect, 'animate', {
            'data-type': this.type,
            attributeName: 'fill',
            values: (this.type == 'match' ? highlightMatchSequence
                     : highlightTextSequence),
            dur: highlightDuration,
            repeatCount: 'indefinite',
            begin: 'indefinite'
          });
        });

        svg.path(sentNumGroup, svg.createPath().
          move(sentNumMargin, 0).
          line(sentNumMargin, data.height));

        if (reuse) {
          setTimeout(function() {
            $('animate[fill="freeze"]').remove();
            $.each(trash, function() {
              $(this).remove();
            });
            $.each(additions, function() {
              this();
            });
          }, 1100); // hopefully enough?
        }
      };


      var drawing = false;
      var redraw = false;

      var renderDataReal = function(sourceData, reuse) {

Util.profileEnd('before render');
Util.profileStart('render');
Util.profileStart('calculation');
Util.profileStart('init');
reuse = true;

        var oldData = null;

        if (!sourceData && !data) { 
          dispatcher.post('doneRendering', [coll, doc, args]);
          return;
        }
        $svgDiv.show();
        if ((sourceData && (sourceData.document !== doc || sourceData.collection !== coll)) || drawing) {
          redraw = true;
          dispatcher.post('doneRendering', [coll, doc, args]);
          return;
        }
        redraw = false;
        drawing = true;

        if (reuse) reuse = data; // old data copy
        if (sourceData) setData(sourceData);
        showMtime();

        // clear the SVG
        if (!reuse) svg.clear(true);
        if (!data || data.length == 0) return;

        // establish the width according to the enclosing element
        canvasWidth = that.forceWidth || $svgDiv.width();


Util.profileEnd('init');
Util.profileStart('measures');

        // TODO reuse measurements
        var sizes = getTextAndSpanTextMeasurements();
        data.sizes = sizes;

        adjustTowerAnnotationSizes();
        var maxTextWidth = 0;
        $.each(sizes.texts.widths, function(text, width) {
          if (width > maxTextWidth) maxTextWidth = width;
        });
        addArcTextMeasurements(sizes);

Util.profileEnd('measures');
Util.profileStart('chunks');

        var currentX = Configuration.visual.margin.x + sentNumMargin + rowPadding;
        var spanHeights = [];
        var sentenceToggle = 0;
        var sentenceNumber = 0;
        var row = new Row();
        row.sentence = ++sentenceNumber;
        row.backgroundIndex = sentenceToggle;
        row.index = 0;
        var rowIndex = 0;
        var reservations;
        var twoBarWidths; // HACK to avoid measuring space's width
        var openTextHighlights = {};
        var textMarkedRows = [];
        data.rows = [];

        $.each(data.chunks, function(chunkNo, chunk) {
          reservations = new Array();

          var y = 0;
          var minArcDist;
          var hasLeftArcs, hasRightArcs, hasInternalArcs;
          var hasAnnotations;
          var chunkFrom = Infinity;
          var chunkTo = 0;
          var chunkHeight = 0;
          var spacing = 0;
          var spacingChunkId = null;
          var spacingRowBreak = 0;
          $.each(chunk.spans, function(spanNo, span) {
            var spanDesc = spanTypes[span.type];
            var bgColor = ((spanDesc && spanDesc.bgColor) || 
                           (spanTypes.SPAN_DEFAULT &&
                            spanTypes.SPAN_DEFAULT.bgColor) || '#ffffff');
            span.fgColor = ((spanDesc && spanDesc.fgColor) || 
                           (spanTypes.SPAN_DEFAULT &&
                            spanTypes.SPAN_DEFAULT.fgColor) || '#000000');
            var borderColor = ((spanDesc && spanDesc.borderColor) || 
                               (spanTypes.SPAN_DEFAULT &&
                                spanTypes.SPAN_DEFAULT.borderColor) || '#000000');

            // special case: if the border 'color' value is 'darken',
            // then just darken the BG color a bit for the border.
            if (borderColor == 'darken') {
                borderColor = Util.adjustColorLightness(bgColor, -0.6);
            }
            
            var spanHeight = 0;

            if (!y) y = -sizes.texts.height - Configuration.visual.curlyHeight;
            var x = (span.curly.from + span.curly.to) / 2;

            // XXX is it maybe sizes.texts?
            var yy = y + sizes.spans.y;
            var hh = sizes.spans.height;
            var ww = span.width;
            var xx = x - ww / 2;

            // text margin fine-tuning
            yy += boxTextMargin.y;
            hh -= 2*boxTextMargin.y;
            xx += boxTextMargin.x;
            ww -= 2*boxTextMargin.x;
            var rectClass = 'span_' + (span.cue || span.type) + ' span_default';

            // attach e.g. "False_positive" into the type
            if (span.comment && span.comment.type) { rectClass += ' '+span.comment.type; }
            var bx = xx - Configuration.visual.margin.x - boxTextMargin.x;
            var by = yy - Configuration.visual.margin.y;
            var bw = ww + 2 * Configuration.visual.margin.x;
            var bh = hh + 2 * Configuration.visual.margin.y;

            if (roundCoordinates) {
              x  = (x|0)+0.5;
              bx = (bx|0)+0.5;              
            }
            this.curly.x = x;

            if (span.marked) {
              chunkFrom = Math.min(bx - markedSpanSize, chunkFrom);
              chunkTo = Math.max(bx + bw + markedSpanSize, chunkTo);
              spanHeight = Math.max(bh + 2 * markedSpanSize, spanHeight);
            }
            if (span.shadowClass) {
              chunkFrom = Math.min(bx - rectShadowSize, chunkFrom);
              chunkTo = Math.max(bx + bw + rectShadowSize, chunkTo);
              spanHeight = Math.max(bh + 2 * rectShadowSize, spanHeight);
            }
            span.box = {
              x: bx, y: by, w: bw, h: bh,
              opts: {
                'class': rectClass,
                fill: bgColor,
                stroke: borderColor,
                rx: Configuration.visual.margin.x,
                ry: Configuration.visual.margin.y,
                'data-span-id': span.id,
                'strokeDashArray': span.attributeMerge.dashArray,
              },
            };
            span.plainbox = { x: xx, y: yy, w: ww, h: hh };
            span.right = bx + bw; // TODO put it somewhere nicer?
            if (!(span.shadowClass || span.marked)) {
              chunkFrom = Math.min(bx, chunkFrom);
              chunkTo = Math.max(bx + bw, chunkTo);
              spanHeight = Math.max(bh, spanHeight);
            }

            span.yAdjust = placeReservation(span, bx, bw, bh, reservations);
            span.box.y -= span.yAdjust;

            // this is monotonous due to sort:
            span.height = span.yAdjust + hh + 3 * Configuration.visual.margin.y + Configuration.visual.curlyHeight + Configuration.visual.arcSpacing;
            spanHeights[span.lineIndex * 2] = span.height;
            span.textY = -sizes.texts.height - Configuration.visual.curlyHeight - span.yAdjust;

            // Make curlies to show the span
            if (span.drawCurly) {
              if (coloredCurlies) {
                var spanDesc = spanTypes[span.type];
                var bgColor = ((spanDesc && spanDesc.bgColor) ||
                               (spanTypes.SPAN_DEFAULT &&
                                spanTypes.SPAN_DEFAULT.fgColor) || 
                               '#000000');
                span.curly.color = Util.adjustColorLightness(bgColor, -0.6);
              } else {
                span.curly.color = 'grey';
              }
              chunkFrom = Math.min(span.curly.from, chunkFrom);
              chunkTo = Math.max(span.curly.to, chunkTo);
              spanHeight = Math.max(Configuration.visual.curlyHeight, spanHeight);
            }

            // find the gap to fit the backwards arcs
            $.each(span.incoming, function(arcId, arc) {
              var leftSpan = data.spans[arc.origin];
              var origin = leftSpan.chunk;
              var border;
              if (chunk.index == origin.index) {
                hasInternalArcs = true;
              }
              if (origin.row) {
                var labels = Util.getArcLabels(spanTypes, leftSpan.type, arc.type);
                if (!labels.length) labels = [arc.type];
                if (origin.row.index == rowIndex) {
                  // same row, but before this
                  border = origin.textX + leftSpan.right;
                } else {
                  border = Configuration.visual.margin.x + sentNumMargin + rowPadding;
                }
                var labelNo = Configuration.abbrevsOn ? labels.length - 1 : 0;
                var smallestLabelWidth = sizes.arcs.widths[labels[labelNo]] + 2 * minArcSlant;
                var gap = currentX + bx - border;
                var arcSpacing = smallestLabelWidth - gap;
                if (!hasLeftArcs || spacing < arcSpacing) {
                  spacing = arcSpacing;
                  spacingChunkId = origin.index + 1;
                }
                arcSpacing = smallestLabelWidth - bx;
                if (!hasLeftArcs || spacingRowBreak < arcSpacing) {
                  spacingRowBreak = arcSpacing;
                }
                hasLeftArcs = true;
              } else {
                hasRightArcs = true;
              }
            });
            $.each(span.outgoing, function(arcId, arc) {
              var leftSpan = data.spans[arc.target];
              var target = leftSpan.chunk;
              var border;
              if (target.row) {
                var labels = Util.getArcLabels(spanTypes, span.type, arc.type);
                if (!labels.length) labels = [arc.type];
                if (target.row.index == rowIndex) {
                  // same row, but before this
                  border = target.textX + leftSpan.right;
                } else {
                  border = Configuration.visual.margin.x + sentNumMargin + rowPadding;
                }
                var labelNo = Configuration.abbrevsOn ? labels.length - 1 : 0;
                var smallestLabelWidth = sizes.arcs.widths[labels[labelNo]] + 2 * minArcSlant;
                var gap = currentX + bx - border;
                var arcSpacing = smallestLabelWidth - gap;
                if (!hasLeftArcs || spacing < arcSpacing) {
                  spacing = arcSpacing;
                  spacingChunkId = target.index + 1;
                }
                arcSpacing = smallestLabelWidth - bx;
                if (!hasLeftArcs || spacingRowBreak < arcSpacing) {
                  spacingRowBreak = arcSpacing;
                }
                hasLeftArcs = true;
              } else {
                hasRightArcs = true;
              }
            });
            spanHeight += span.yAdjust || Configuration.visual.curlyHeight;
            if (spanHeight > chunkHeight) chunkHeight = spanHeight;
            hasAnnotations = true;
          }); // spans

          // positioning of the chunk
          chunk.right = chunkTo;
          var textWidth = sizes.texts.widths[chunk.text];
          chunkHeight += sizes.texts.height;
          var boxX = -Math.min(chunkFrom, 0);
          var boxWidth =
              Math.max(textWidth, chunkTo) -
              Math.min(0, chunkFrom);
          // if (hasLeftArcs) {
            // TODO change this with smallestLeftArc
            // var spacing = arcHorizontalSpacing - (currentX - lastArcBorder);
            // arc too small?
          if (spacing > 0) currentX += spacing;
          // }
          var rightBorderForArcs = hasRightArcs ? arcHorizontalSpacing : (hasInternalArcs ? arcSlant : 0);

          var lastX = currentX;
          var lastRow = row;

          if (chunk.sentence) {
            while (sentenceNumber < chunk.sentence) {
              sentenceNumber++;
              data.rows.push(row);
              row = new Row();
              sentenceToggle = 1 - sentenceToggle;
              row.backgroundIndex = sentenceToggle;
              row.index = ++rowIndex;
            }
            sentenceToggle = 1 - sentenceToggle;
          }

          if (chunk.sentence ||
              currentX + boxWidth + rightBorderForArcs >= canvasWidth - 2 * Configuration.visual.margin.x) {
            // TODO: related to issue #571
            // replace arcHorizontalSpacing with a calculated value
            currentX = Configuration.visual.margin.x + sentNumMargin + rowPadding +
                (hasLeftArcs ? arcHorizontalSpacing : (hasInternalArcs ? arcSlant : 0));
            if (hasLeftArcs) {
              var adjustedCurTextWidth = sizes.texts.widths[chunk.text] + arcHorizontalSpacing;
              if (adjustedCurTextWidth > maxTextWidth) {
                maxTextWidth = adjustedCurTextWidth;
              }
            }
            if (spacingRowBreak > 0) {
              currentX += spacingRowBreak;
              spacing = 0; // do not center intervening elements
            }

            // new row
            data.rows.push(row);

            row = new Row();
            row.backgroundIndex = sentenceToggle;
            row.index = ++rowIndex;
            /* XXX cut - probably unnecessary, but check
            $(chunk.group).children("g[class='span']").
              each(function(index, element) {
                  chunk.spans[index].group = element;
              });
            $(chunk.group).find("rect[data-span-id]").
              each(function(index, element) {
                  chunk.spans[index].rect = element;
              });
            */
          }

          // break the text highlights when the row breaks
          if (row.index !== lastRow.index) {
            $.each(openTextHighlights, function(textId, textDesc) {
              if (textDesc[3] != lastX) {
                var newDesc = [lastRow, textDesc[3], lastX + boxX, textDesc[4]];
                textMarkedRows.push(newDesc);
              }
              textDesc[3] = currentX;
            });
          }

          // open text highlights
          $.each(chunk.markedTextStart, function(textNo, textDesc) {
            textDesc[3] += currentX + boxX;
            openTextHighlights[textDesc[0]] = textDesc;
          });

          // close text highlights
          $.each(chunk.markedTextEnd, function(textNo, textDesc) {
            textDesc[3] += currentX + boxX;
            var startDesc = openTextHighlights[textDesc[0]];
            delete openTextHighlights[textDesc[0]];
            markedRow = [row, startDesc[3], textDesc[3], startDesc[4]];
            textMarkedRows.push(markedRow);
          });

          // XXX check this - is it used? should it be lastRow?
          if (hasAnnotations) row.hasAnnotations = true;

          if (chunk.sentence) {
            row.sentence = ++sentenceNumber;
          }

          if (spacing > 0) {
            // if we added a gap, center the intervening elements
            spacing /= 2;
            var firstChunkInRow = row.chunks[row.chunks.length - 1];
            if (spacingChunkId < firstChunkInRow.index) {
              spacingChunkId = firstChunkInRow.index + 1;
            }
            for (var chunkIndex = spacingChunkId; chunkIndex < chunk.index; chunkIndex++) {
              var movedChunk = data.chunks[chunkIndex];
              movedChunk.textX += spacing;
            }
          }

          row.chunks.push(chunk);
          chunk.row = row;

          chunk.textX = currentX + boxX;

          var spaceWidth = 0;
          var spaceLen = chunk.nextSpace && chunk.nextSpace.length || 0;
          for (var i = 0; i < spaceLen; i++) spaceWidth += spaceWidths[chunk.nextSpace[i]] || 0;
          currentX += spaceWidth + boxWidth;
        }); // chunks

        // finish the last row
        data.rows.push(row);

Util.profileEnd('chunks');
Util.profileStart('arcsPrep');

        var arrows = {};
        var arrow = makeArrow('none');
        if (arrow) arrows['none'] = arrow;

        var len = spanHeights.length;
        for (var i = 0; i < len; i++) {
          if (!spanHeights[i] || spanHeights[i] < Configuration.visual.arcStartHeight) {
            spanHeights[i] = Configuration.visual.arcStartHeight;
          }
        }

        // find out how high the arcs have to go
        $.each(data.arcs, function(arcNo, arc) {
          arc.jumpHeight = 0;
          var fromSpan = data.spans[arc.origin];
          var toSpan = data.spans[arc.target];
          if (fromSpan.lineIndex > toSpan.lineIndex) {
            var tmp = fromSpan; fromSpan = toSpan; toSpan = tmp;
          }
          var from, to;
          if (fromSpan.chunk.index == toSpan.chunk.index) {
            from = fromSpan.lineIndex;
            to = toSpan.lineIndex;
          } else {
            from = fromSpan.lineIndex + 1;
            to = toSpan.lineIndex - 1;
          }
          for (var i = from; i <= to; i++) {
            if (arc.jumpHeight < spanHeights[i * 2]) arc.jumpHeight = spanHeights[i * 2];
          }
        });

        // sort the arcs
        data.arcs.sort(function(a, b) {
          // first write those that have less to jump over
          var tmp = a.jumpHeight - b.jumpHeight;
          if (tmp) return tmp < 0 ? -1 : 1;
          // if equal, then those that span less distance
          tmp = a.dist - b.dist;
          if (tmp) return tmp < 0 ? -1 : 1;
          // if equal, then those where heights of the targets are smaller
          tmp = data.spans[a.origin].height + data.spans[a.target].height -
            data.spans[b.origin].height - data.spans[b.target].height;
          if (tmp) return tmp < 0 ? -1 : 1;
          // if equal, then those with the lower origin
          tmp = data.spans[a.origin].height - data.spans[b.origin].height;
          if (tmp) return tmp < 0 ? -1 : 1;
          // if equal, they're just equal.
          return 0;
        });

Util.profileEnd('arcsPrep');
Util.profileStart('arcs');

        // add the arcs
        $.each(data.arcs, function(arcNo, arc) {
          // separate out possible numeric suffix from type
          var noNumArcType;
          var splitArcType;
          if (arc.type) {
            splitArcType = arc.type.match(/^(.*?)(\d*)$/);
            noNumArcType = splitArcType[1];
          }

          var originSpan = data.spans[arc.origin];
          var targetSpan = data.spans[arc.target];

          var leftToRight = originSpan.lineIndex < targetSpan.lineIndex;
          var left, right;
          if (leftToRight) {
            left = originSpan;
            right = targetSpan;
          } else {
            left = targetSpan;
            right = originSpan;
          }

          var spanDesc = spanTypes[originSpan.type];
          // TODO: might make more sense to reformat this as dict instead
          // of searching through the list every type
          var arcDesc;
          if (spanDesc && spanDesc.arcs) {
            $.each(spanDesc.arcs, function(arcDescNo, arcDescIter) {
                if (arcDescIter.type == arc.type) {
                  arcDesc = arcDescIter;
                }
              });            
          }
          // fall back on unnumbered type if not found in full
          if (!arcDesc && noNumArcType && noNumArcType != arc.type &&
            spanDesc && spanDesc.arcs) {
            $.each(spanDesc.arcs, function(arcDescNo, arcDescIter) {
                if (arcDescIter.type == noNumArcType) {
                  arcDesc = arcDescIter;
                }
              });            
          }
          // fall back on relation types in case origin span type is
          // undefined
          // then final fallback to unnumbered relation
          // HACK: instead of falling back, extend (since
          // relation_types has more info!)
          $.extend(arcDesc, relationTypesHash[arc.type] || relationTypesHash[noNumArcType]);

          var color = ((arcDesc && arcDesc.color) || 
                       (spanTypes.ARC_DEFAULT && spanTypes.ARC_DEFAULT.color) ||
                       '#000000');
          var symmetric = arcDesc && arcDesc.properties && arcDesc.properties.symmetric;
          var hashlessColor = color.replace('#', '');
          var dashArray = arcDesc && arcDesc.dashArray;
          var arrowHead = ((arcDesc && arcDesc.arrowHead) ||
                           (spanTypes.ARC_DEFAULT && spanTypes.ARC_DEFAULT.arrowHead) ||
                           'triangle,5') + ',' + hashlessColor;

          var leftt = left.chunk.textX;
          var rightt = right.chunk.textX;
          var leftRow = left.chunk.row.index;
          var rightRow = right.chunk.row.index;

          if (!arrows[arrowHead]) {
            var arrow = makeArrow(arrowHead);
            if (arrow) arrows[arrowHead] = arrow;
          }

          // find the next height
          var height = 0;

          var fromIndex2, toIndex2;
          if (left.chunk.index == right.chunk.index) {
            fromIndex2 = left.lineIndex * 2;
            toIndex2 = right.lineIndex * 2;
          } else {
            fromIndex2 = left.lineIndex * 2 + 1;
            toIndex2 = right.lineIndex * 2 - 1;
          }
          for (var i = fromIndex2; i <= toIndex2; i++) {
            if (spanHeights[i] > height) height = spanHeights[i];
          }
          height += Configuration.visual.arcSpacing;
          var leftSlantBound, rightSlantBound;
          for (var i = fromIndex2; i <= toIndex2; i++) {
            if (spanHeights[i] < height) spanHeights[i] = height;
          }

          // Adjust the height to align with pixels when rendered

          // TODO: on at least Chrome, this doesn't make a difference:
          // the lines come out pixel-width even without it. Check.
          height += 0.5;

          var chunkReverse = false;
          var ufoCatcher = originSpan.chunk.index == targetSpan.chunk.index;
          if (ufoCatcher) {
            chunkReverse =
              leftt + left.box.x + left.box.w / 2 < rightt + right.box.x + right.box.w / 2;
          }
          var ufoCatcherMod = ufoCatcher ? chunkReverse ? -0.5 : 0.5 : 1;

          var myArrowHead   = ((arcDesc && arcDesc.arrowHead) || 
                               (spanTypes.ARC_DEFAULT && spanTypes.ARC_DEFAULT.arrowHead));

          for (var rowIndex = leftRow; rowIndex <= rightRow; rowIndex++) {
            var row = data.rows[rowIndex];
            row.hasAnnotations = true;
            var from, to;
            
            if (rowIndex == leftRow) {
              from = leftt + left.box.x + (chunkReverse ? 0 : left.box.w);
            } else {
              from = sentNumMargin;
            }

            if (rowIndex == rightRow) {
              to = rightt + right.box.x + (chunkReverse ? right.box.w : 0);
            } else {
              to = canvasWidth - 2 * Configuration.visual.margin.y;
            }

            var originType = data.spans[arc.origin].type;
            var arcLabels = Util.getArcLabels(spanTypes, originType, arc.type);
            var labelText = Util.arcDisplayForm(spanTypes, originType, arc.type);
            // if (Configuration.abbrevsOn && !ufoCatcher && arcLabels) {
            if (Configuration.abbrevsOn && arcLabels) {
              var labelIdx = 1; // first abbreviation
              // strictly speaking 2*arcSlant would be needed to allow for
              // the full-width arcs to fit, but judged unabbreviated text
              // to be more important than the space for arcs.
              var maxLength = (to - from) - (arcSlant);
              while (sizes.arcs.widths[labelText] > maxLength &&
                     arcLabels[labelIdx]) {
                labelText = arcLabels[labelIdx];
                labelIdx++;
              }
            }

            var lineData = {
              arc: arc,
              from: from,
              to: to,
              height: -height,
              color: color,
              options: {
                'fill': color,
                'data-arc-role': arc.type,
                'data-arc-origin': arc.origin,
                'data-arc-target': arc.target,
                'data-arc-id': arc.id,
                'data-arc-ed': arc.eventDescId,
              },
            };

            // construct SVG text, showing possible trailing index
            // numbers (as in e.g. "Theme2") as subscripts
            // It's just an object - not drawn on SVG yet - so OK to do here
            var svgText;
            if (!splitArcType[2]) {
                // no subscript, simple string suffices
                svgText = labelText;
            } else {
                // Need to parse out possible numeric suffixes to avoid
                // duplicating number in label and its subscript
                var splitLabelText = labelText.match(/^(.*?)(\d*)$/);
                var noNumLabelText = splitLabelText[1];

                svgText = svg.createText();
                // TODO: to address issue #453, attaching options also
                // to spans, not only primary text. Make sure there
                // are no problems with this.
                svgText.span(noNumLabelText, lineData.options);
                var subscriptSettings = {
                  'dy': '0.3em', 
                  'font-size': '80%'
                };
                // alternate possibility
//                 var subscriptSettings = {
//                   'baseline-shift': 'sub',
//                   'font-size': '80%'
//                 };
                $.extend(subscriptSettings, lineData.options);
                svgText.span(splitArcType[2], subscriptSettings);
            }
            lineData.svgText = svgText;

            var width = sizes.arcs.widths[labelText];
            var textBox = {
              x: (from + to - width) / 2,
              width: width,
              y: -height - sizes.arcs.height / 2,
              height: sizes.arcs.height,
            }
            lineData.textBox = textBox;
            if (roundCoordinates) {
              // don't ask
              height = (height|0)+0.5;
            }

            var textStart = textBox.x;
            var textEnd = textStart + textBox.width;

            // adjust by margin for arc drawing
            textStart -= Configuration.visual.arcTextMargin;
            textEnd += Configuration.visual.arcTextMargin;

            if (from > to) {
              var tmp = textStart; textStart = textEnd; textEnd = tmp;
            }

            lineData.textStart = textStart;
            lineData.textEnd = textEnd;

            var lcornerx, lcontrolx, ltexty, larrow;
            var rcornerx, rcontrolx, rtexty, rarrow;
            // TODO XXX there are extra calculations being done for
            // non-leftRow or non-rightRow lines
            // do we care?
            lcornerx = from + ufoCatcherMod * arcSlant;
            rcornerx = to - ufoCatcherMod * arcSlant;
            // for normal cases, should not be past textStart even if narrow
            if (!ufoCatcher) {
              if (lcornerx > textStart) { lcornerx = textStart; }
              if (rcornerx < textEnd) { rcornerx = textEnd; }
            }
            if (smoothArcCurves) {
              // we don't care about it if not drawing smooth curves;
              // it can be left undefined
              lcontrolx = ufoCatcher
                  ? lcornerx + 2 * ufoCatcherMod * reverseArcControlx
                  : smoothArcSteepness * from + (1 - smoothArcSteepness) * lcornerx;
              rcontrolx = ufoCatcher
                  ? rcornerx - 2 * ufoCatcherMod * reverseArcControlx
                  : smoothArcSteepness * to + (1 - smoothArcSteepness) * rcornerx;
            }
            ltexty = left.box.y +
                (leftToRight || arc.equiv ? left.box.h / 2 : Configuration.visual.margin.y);
            rtexty = right.box.y +
                (leftToRight && !arc.equiv ? Configuration.visual.margin.y : right.box.h / 2);
            larrow = arrows[(leftToRight ?
                symmetric && myArrowHead || 'none' :
                myArrowHead || 'triangle,5') + ',' + hashlessColor];
            rarrow = arrows[(leftToRight ?
                myArrowHead || 'triangle,5' :
                symmetric && myArrowHead || 'none') + ',' + hashlessColor];

            lineData.sides = [{
              x0: textStart,
              x1: lcornerx,
              x2: lcontrolx,
              x3: from,
              y0: -height,
              y3: ltexty,
              edgeRow: row.index == leftRow,
              arrow: larrow
            }, {
              x0: textEnd,
              x1: rcornerx,
              x2: rcontrolx,
              x3: to,
              y0: -height,
              y3: rtexty,
              edgeRow: row.index == rightRow,
              arrow: rarrow
            }];

            if (height > row.maxArcHeight) row.maxArcHeight = height;
            row.lines.push(lineData);
          } // arc rows
        }); // arcs

Util.profileEnd('arcs');
Util.profileStart('rows');

        // position the rows
        var y = Configuration.visual.margin.y;
        var currentSent;
        $.each(data.rows, function(rowId, row) {
          $.each(row.chunks, function(chunkId, chunk) {
            $.each(chunk.spans, function(spanid, span) {
              if (row.maxSpanHeight < span.height) row.maxSpanHeight = span.height;
            });
          });
          if (row.sentence) {
            currentSent = row.sentence;
          }
          // SLOW (#724) and replaced with calculations:
          //
          // var rowBox = row.group.getBBox();
          // // Make it work on IE
          // rowBox = { x: rowBox.x, y: rowBox.y, height: rowBox.height, width: rowBox.width };
          // // Make it work on Firefox and Opera
          // if (rowBox.height == -Infinity) {
          //   rowBox = { x: 0, y: 0, height: 0, width: 0 };
          // }

          // XXX TODO HACK: find out where 5 and 1.5 come from!
          // This is the fix for #724, but the numbers are guessed.
          var rowBoxHeight = Math.max(row.maxArcHeight + 5, row.maxSpanHeight + 1.5); // XXX TODO HACK: why 5, 1.5?
          if (row.hasAnnotations) {
            // rowBox.height = -rowBox.y + rowSpacing;
            rowBoxHeight += rowSpacing + 1.5; // XXX TODO HACK: why 1.5?
          } else {
            rowBoxHeight -= 5; // XXX TODO HACK: why -5?
          }

          rowBoxHeight += rowPadding;
          row.height = rowBoxHeight;
          row.y = y;
          if (data.markedSent[currentSent]) {
            // specifically highlighted
            row.bgClass = 'backgroundHighlight';
          } else if (Configuration.textBackgrounds == "striped") {
            // give every other sentence a different bg class
            row.bgClass = 'background'+ row.backgroundIndex;
          } else {
            // plain "standard" bg
            row.bgClass = 'background0';
          }
          y += rowBoxHeight;
          y += sizes.texts.height;
          row.yt = y;
          row.textY = y - rowPadding;
          
          // XXX removed - what did it do?
          // var rowY = y - rowPadding;
          // if (roundCoordinates) {
          //   rowY = rowY|0;
          // }
          // row.y += rowY; // TODO CHECK: possibly somewhere we need row.translation
          y += Configuration.visual.margin.y;
        });
        y += Configuration.visual.margin.y;

Util.profileEnd('rows');
Util.profileStart('chunkFinish');

        // chunk index sort functions for overlapping span drawing
        // algorithm; first for left-to-right pass, sorting primarily
        // by start offset, second for right-to-left pass by end
        // offset. Secondary sort by span length in both cases.
        var currentChunk;
        var lrChunkComp = function(a,b) { 
          var ac = currentChunk.spans[a];
          var bc = currentChunk.spans[b]
          var startDiff = Util.cmp(ac.from, bc.from);
          return startDiff != 0 ? startDiff : Util.cmp(bc.to-bc.from, ac.to-ac.from);
        }
        var rlChunkComp = function(a,b) { 
          var ac = currentChunk.spans[a];
          var bc = currentChunk.spans[b]
          var endDiff = Util.cmp(bc.to, ac.to);
          return endDiff != 0 ? endDiff : Util.cmp(bc.to-bc.from, ac.to-ac.from);
        }

        var sentenceText;
        data.chunks[0].row.text = sentenceText = svg.createText();
        $.each(data.chunks, function(chunkNo, chunk) {
          // context for sort
          currentChunk = chunk;

          // text rendering
          if (chunk.sentence) {
            chunk.row.text = sentenceText = svg.createText();
          }
          var nextChunk = data.chunks[chunkNo + 1];
          var nextSpace = nextChunk ? nextChunk.space : '';
          sentenceText.span(chunk.text + nextSpace, {
            x: chunk.textX,
            y: chunk.row.textY,
            'data-chunk-id': chunk.index
          });

          // chunk backgrounds
          if (chunk.spans.length) {
            var orderedIdx = [];
            for (var i=chunk.spans.length-1; i>=0; i--) {
              orderedIdx.push(i);
            }

            // Mark entity nesting height/depth (number of
            // nested/nesting entities). To account for crossing
            // brackets in a (mostly) reasonable way, determine
            // depth/height separately in a left-to-right traversal
            // and a right-to-left traversal.
            orderedIdx.sort(lrChunkComp);              
            
            var openSpans = [];
            for(var i=0; i<orderedIdx.length; i++) {
              var current = chunk.spans[orderedIdx[i]];
              current.nestingHeightLR = 0;
              current.nestingDepthLR = 0;
              var stillOpen = [];
              for(var o=0; o<openSpans.length; o++) {
                if(openSpans[o].to > current.from) {
                  stillOpen.push(openSpans[o]);
                  openSpans[o].nestingHeightLR++;
                }
              }
              openSpans = stillOpen;
              current.nestingDepthLR=openSpans.length;
              openSpans.push(current);
            }

            // re-sort for right-to-left traversal by end position
            orderedIdx.sort(rlChunkComp);

            openSpans = [];
            for(var i=0; i<orderedIdx.length; i++) {
              var current = chunk.spans[orderedIdx[i]];
              current.nestingHeightRL = 0;
              current.nestingDepthRL = 0;
              var stillOpen = [];
              for(var o=0; o<openSpans.length; o++) {
                if(openSpans[o].from < current.to) {
                  stillOpen.push(openSpans[o]);
                  openSpans[o].nestingHeightRL++;
                }
              }
              openSpans = stillOpen;
              current.nestingDepthRL=openSpans.length;
              openSpans.push(current);
            }

            // the effective depth and height are the max of those
            // for the left-to-right and right-to-left traversals.
            for(var i=0; i<orderedIdx.length; i++) {
              var c = chunk.spans[orderedIdx[i]];
              c.nestingHeight = c.nestingHeightLR > c.nestingHeightRL ? c.nestingHeightLR : c.nestingHeightRL;
              c.nestingDepth = c.nestingDepthLR > c.nestingDepthRL ? c.nestingDepthLR : c.nestingDepthRL;
            }              

            // Re-order by nesting height and draw in order
            orderedIdx.sort(function(a,b) { return Util.cmp(chunk.spans[b].nestingHeight, chunk.spans[a].nestingHeight) });

            for(var i=0; i<chunk.spans.length; i++) {
              var span=chunk.spans[orderedIdx[i]];
              var spanDesc = spanTypes[span.type];
              var bgColor = ((spanDesc && spanDesc.bgColor) ||
                             (spanTypes.SPAN_DEFAULT && spanTypes.SPAN_DEFAULT.bgColor) ||
                             '#ffffff');

              // Tweak for nesting depth/height. Recognize just three
              // levels for now: normal, nested, and nesting, where
              // nested+nesting yields normal. (Currently testing
              // minor tweak: don't shrink for depth 1 as the nesting 
              // highlight will grow anyway [check nestingDepth > 1])
              var shrink = 0;
              if (span.nestingDepth > 1 && span.nestingHeight == 0) {
                  shrink = 1;
              } else if (span.nestingDepth == 0 && span.nestingHeight > 0) {
                  shrink = -1;
              }
              var yShrink = shrink * nestingAdjustYStepSize;
              var xShrink = shrink * nestingAdjustXStepSize;
              // bit lighter
              span.lightBgColor = Util.adjustColorLightness(bgColor, 0.8);
              // tweak for Y start offset (and corresponding height
              // reduction): text rarely hits font max height, so this
              // tends to look better
              var yStartTweak = 1;
              // store to have same mouseover highlight without recalc              
              span.highlightPos = {
                  x: chunk.textX + span.curly.from + xShrink, 
                  y: chunk.row.textY + sizes.texts.y + yShrink + yStartTweak,
                  w: span.curly.to - span.curly.from - 2*xShrink, 
                  h: sizes.texts.height - 2*yShrink - yStartTweak,
              };
            }
          }
        });

        // draw the markedText
        data.textHighlights = [];
        $.each(textMarkedRows, function(textRowNo, textRowDesc) { // row, from, to
          data.textHighlights.push({
            x: textRowDesc[1] - 2,
            y: textRowDesc[0].textY - sizes.spans.height,
            w: textRowDesc[2] - textRowDesc[1] + 4,
            h: sizes.spans.height + 4,
            type: textRowDesc[3],
          });
        });
        data.height = y;

        $.each(data.spans, function() {
          var yt = this.chunk.row.yt;
          var xt = this.chunk.textX;
          this.box.x += xt;
          this.box.y += yt;
          this.plainbox.x += xt;
          this.plainbox.y += yt;
          this.curly.from += xt;
          this.curly.to += xt;
          this.curly.x += xt;
          this.textY += yt;
        }); // spans
        $.each(data.rows, function() {
          var yt = this.yt;
          $.each(this.lines, function() {
            this.height += yt;
            $.each(this.sides, function() {
              this.y3 += yt;
            }); // sides
          }); // lines

          // is it a sentence? provide link data
          if (this.sentence) {
            var sentenceHash = new URLHash(coll, doc, { focus: [[ 'sent', row.sentence ]] } );
            row.sentComment = data.sentComment[row.sentence];

            var sentenceLink = {
              link: sentenceHash.getHash(),
              x: sentNumMargin - Configuration.visual.margin.x,
              y: this.textY
            };

            if (this.sentComment) {
              sentenceLink.boxX = x - data.sizes.sentNos.widths[this.sentence];
              sentenceLink.boxY = this.textY - data.sizes.sentNos.height;
              sentenceLink.bgClass = 'shadow_' + this.sentComment.type;
            }

            data.sentenceLinks[this.sentence] = sentenceLink;
          }
        }); // rows

        // find out the size
        var width = maxTextWidth + sentNumMargin + 2 * Configuration.visual.margin.x + 1;
        if (width > canvasWidth) canvasWidth = width;
        data.canvasWidth = canvasWidth;
        data.canvasHeight = y;

Util.profileEnd('chunkFinish');
Util.profileEnd('calculation');
Util.profileStart('SVG');
        addElementsToSVG(reuse);
Util.profileEnd('SVG');
Util.profileStart('finish');

        // resize the SVG
        $svg.width(canvasWidth);
        $svg.height(y);
        $svgDiv.height(y);

Util.profileEnd('finish');
Util.profileEnd('render');
Util.profileReport();


        drawing = false;
        if (redraw) {
          redraw = false;
          renderDataReal();
        }
        $svg.find('animate').each(function() {
          if (this.beginElement) { // protect against non-SMIL browsers
            this.beginElement();
          }
        });
        dispatcher.post('doneRendering', [coll, doc, args]);
      };

      var renderErrors = {
        unableToReadTextFile: true,
        annotationFileNotFound: true,
        isDirectoryError: true
      };
      var renderData = function(sourceData, reuse) {
        Util.profileEnd('invoke getDocument');
        if (sourceData && sourceData.exception) {
          if (renderErrors[sourceData.exception]) {
            dispatcher.post('renderError:' + sourceData.exception, [sourceData]);
          } else {
            dispatcher.post('unknownError', [sourceData.exception]);
          }
        } else {
          dispatcher.post('startedRendering', [coll, doc, args]);
          dispatcher.post('spin');
          setTimeout(function() {
              renderDataReal(sourceData, reuse);
              dispatcher.post('unspin');
          }, 0);
        }
      };

      var renderDocument = function() {
        Util.profileStart('invoke getDocument');
        dispatcher.post('ajax', [{
            action: 'getDocument',
            collection: coll,
            'document': doc,
          }, 'renderData', {
            collection: coll,
            'document': doc
          }]);
      };

      var triggerRender = function() {
        if (svg && isRenderRequested && isCollectionLoaded && areFontsLoaded) {
          isRenderRequested = false;
          if (doc.length) {

Util.profileClear();
Util.profileStart('before render');

            renderDocument();
          } else {
            dispatcher.post(0, 'renderError:noFileSpecified');
          }
        }
      };

      var collectionChanged = function() {
        isCollectionLoaded = false;
      };

      var gotCurrent = function(_coll, _doc, _args, reloadData) {
        coll = _coll;
        doc  = _doc;
        args = _args;
        if (reloadData) {
          isRenderRequested = true;
          triggerRender();
        }
      };


      // event handlers

      var highlight, highlightArcs, highlightSpans, commentId;

      var onMouseOver = function(evt) {
        var target = $(evt.target);
        var id;
        if (id = target.attr('data-span-id')) {
          commentId = id;
          var span = data.spans[id];
          dispatcher.post('displaySpanComment', [
              evt, target, id, span.type, span.attributeText,
              data.text.substring(span.from, span.to),
              span.comment && span.comment.text,
              span.comment && span.comment.type]);

          var spanDesc = spanTypes[span.type];
          var bgColor = ((spanDesc && spanDesc.bgColor) || 
                         (spanTypes.SPAN_DEFAULT && spanTypes.SPAN_DEFAULT.bgColor) ||
                         '#ffffff');
          highlight = svg.rect(highlightGroup,
                               span.highlightPos.x, span.highlightPos.y,
                               span.highlightPos.w, span.highlightPos.h,
                               { 'fill': bgColor, opacity:0.75,
                                 rx: highlightRounding.x,
                                 ry: highlightRounding.y,
                               });

          if (that.arcDragOrigin) {
            target.parent().addClass('highlight');
          } else {
            highlightArcs = $svg.
                find('g[data-from="' + id + '"], g[data-to="' + id + '"]').
                addClass('highlight');
            var spans = {};
            spans[id] = true;
            var spanIds = [];
            $.each(span.incoming, function(arcNo, arc) {
                spans[arc.origin] = true;
            });
            $.each(span.outgoing, function(arcNo, arc) {
                spans[arc.target] = true;
            });
            $.each(spans, function(spanId, dummy) {
                spanIds.push('rect[data-span-id="' + spanId + '"]');
            });
            highlightSpans = $svg.
                find(spanIds.join(', ')).
                parent().
                addClass('highlight');
          }
          forceRedraw();
        } else if (!that.arcDragOrigin && (id = target.attr('data-arc-role'))) {
          var originSpanId = target.attr('data-arc-origin');
          var targetSpanId = target.attr('data-arc-target');
          var role = target.attr('data-arc-role');
          var symmetric = (relationTypesHash[role] && 
                           relationTypesHash[role].properties &&
                           relationTypesHash[role].properties.symmetric);
          // NOTE: no commentText, commentType for now
          var arcEventDescId = target.attr('data-arc-ed');
          var commentText = '';
          var commentType = '';
          var arcId;
          if (arcEventDescId) {
            var eventDesc = data.eventDescs[arcEventDescId];
            var comment = eventDesc.comment;
            if (comment) {
              commentText = comment.text;
              commentType = comment.type;
              if (commentText == '' && commentType) {
                  // default to type if missing text
                  commentText = commentType;
              }
            }
            if (eventDesc.relation) {
              // among arcs, only ones corresponding to relations have
              // "independent" IDs
              arcId = arcEventDescId;
            }
          }
          var originSpanType = data.spans[originSpanId].type || '';
          var targetSpanType = data.spans[targetSpanId].type || '';
          dispatcher.post('displayArcComment', [
              evt, target, symmetric, arcId,
              originSpanId, originSpanType, role,
              targetSpanId, targetSpanType,
              commentText, commentType]);
          highlightArcs = $svg.
              find('g[data-from="' + originSpanId + '"][data-to="' + targetSpanId + '"]').
              addClass('highlight');
          highlightSpans = $($svg).
              find('rect[data-span-id="' + originSpanId + '"], rect[data-span-id="' + targetSpanId + '"]').
              parent().
              addClass('highlight');
        } else if (id = target.attr('data-sent')) {
          var comment = data.sentComment[id];
          if (comment) {
            dispatcher.post('displaySentComment', [evt, target, comment.text, comment.type]);
          }
        }
      };

      var onMouseOut = function(evt) {
        var target = $(evt.target);
        target.removeClass('badTarget');
        dispatcher.post('hideComment');
        if (highlight) {
          svg.remove(highlight);
          highlight = undefined;
        }
        if (highlightSpans) {
          highlightArcs.removeClass('highlight');
          highlightSpans.removeClass('highlight');
          highlightSpans = undefined;
        }
        forceRedraw();
      };

      var setAbbrevs = function(_abbrevsOn) {
        // TODO: this is a slightly weird place to tweak the configuration
        Configuration.abbrevsOn = _abbrevsOn;
        dispatcher.post('configurationChanged');
      }

      var setTextBackgrounds = function(_textBackgrounds) {
        Configuration.textBackgrounds = _textBackgrounds;
        dispatcher.post('configurationChanged');
      }

      var setLayoutDensity = function(_density) {
        //dispatcher.post('messages', [[['Setting layout density ' + _density, 'comment']]]);
        // TODO: store standard settings instead of hard-coding
        // them here (again)
        if (_density < 2) {
          // dense
          Configuration.visual.margin = { x: 1, y: 0 };
          Configuration.visual.boxSpacing = 1;
          Configuration.visual.curlyHeight = 1;
          Configuration.visual.arcSpacing = 7;
          Configuration.visual.arcStartHeight = 18
        } else if(_density > 2) {
          // spacious
          Configuration.visual.margin = { x: 2, y: 1 };
          Configuration.visual.boxSpacing = 3;
          Configuration.visual.curlyHeight = 6;          
          Configuration.visual.arcSpacing = 12;
          Configuration.visual.arcStartHeight = 23;
        } else {
          // standard
          Configuration.visual.margin = { x: 2, y: 1 };
          Configuration.visual.boxSpacing = 1;
          Configuration.visual.curlyHeight = 4;
          Configuration.visual.arcSpacing = 9;
          Configuration.visual.arcStartHeight = 19;
        }
        dispatcher.post('configurationChanged');
      }

      var setSvgWidth = function(_width) {
        $svgDiv.width(_width);
        if (Configuration.svgWidth != _width) {
          Configuration.svgWidth = _width;
          dispatcher.post('configurationChanged');
        }
      }

      $svgDiv = $($svgDiv).hide();

      // register event listeners
      var registerHandlers = function(element, events) {
        $.each(events, function(eventNo, eventName) {
            element.bind(eventName,
              function(evt) {
                dispatcher.post(eventName, [evt], 'all');
              }
            );
        });
      };
      registerHandlers($svgDiv, [
          'mouseover', 'mouseout', 'mousemove',
          'mouseup', 'mousedown',
          'dragstart',
          'dblclick', 'click'
      ]);
      registerHandlers($(document), [
          'keydown', 'keypress',
          'touchstart', 'touchend'
      ]);
      registerHandlers($(window), [
          'resize'
      ]);

      // create the svg wrapper
      $svgDiv.svg({
          onLoad: function(_svg) {
              that.svg = svg = _svg;
              $svg = $(svg._svg);

              /* XXX HACK REMOVED - not efficient?

              // XXX HACK to allow off-DOM SVG element creation
              // we need to replace the jQuery SVG's _makeNode function
              // with a modified one.
              // Be aware of potential breakage upon jQuery SVG upgrade.
              svg._makeNode = function(parent, name, settings) {
                  // COMMENTED OUT: parent = parent || this._svg;
                  var node = this._svg.ownerDocument.createElementNS($.svg.svgNS, name);
                  for (var name in settings) {
                    var value = settings[name];
                    if (value != null && value != null && 
                        (typeof value != 'string' || value != '')) {
                      node.setAttribute($.svg._attrNames[name] || name, value);
                    }
                  }
                  // ADDED IN:
                  if (parent)
                    parent.appendChild(node);
                  return node;
                };
              */

              triggerRender();
          }
      });

      var loadSpanTypes = function(types) {
        $.each(types, function(typeNo, type) {
          if (type) {
            spanTypes[type.type] = type;
            var children = type.children;
            if (children && children.length) {
              loadSpanTypes(children);
            }
          }
        });
      }

      var loadAttributeTypes = function(response_types) {
        var processed = {};
        $.each(response_types, function(aTypeNo, aType) {
          processed[aType.type] = aType;
          // count the values; if only one, it's a boolean attribute
          var values = [];
          for (var i in aType.values) {
            if (aType.values.hasOwnProperty(i)) {
              values.push(i);
            }
          }
          if (values.length == 1) {
            aType.bool = values[0];
          }
        });
        return processed;
      }

      var collectionLoaded = function(response) {
        if (!response.exception) {
          eventAttributeTypes = loadAttributeTypes(response.event_attribute_types);
          entityAttributeTypes = loadAttributeTypes(response.entity_attribute_types);
          spanTypes = {};
          loadSpanTypes(response.entity_types);
          loadSpanTypes(response.event_types);
          loadSpanTypes(response.unconfigured_types);
          relationTypesHash = {};
          $.each(response.relation_types, function(relTypeNo, relType) {
            relationTypesHash[relType.type] = relType;
          });

          dispatcher.post('spanAndAttributeTypesLoaded', [spanTypes, entityAttributeTypes, eventAttributeTypes, relationTypesHash]);

          isCollectionLoaded = true;
          triggerRender();
        } else {
          // exception on collection load; allow visualizer_ui
          // collectionLoaded to handle this
        }
      };

      var isReloadOkay = function() {
        // do not reload while the user is in the dialog
        return !drawing;
      };

      var proceedWithFonts = function() {
        areFontsLoaded = true;
        console.log("fonts done");
        triggerRender();
      };

      WebFontConfig = {
        custom: {
          families: [
            'Astloch',
            'PT Sans Caption',
            //        'Ubuntu',
            'Liberation Sans'
          ],
          urls: [
            'static/fonts/Astloch-Bold.ttf',
            'static/fonts/PT_Sans-Caption-Web-Regular.ttf',
            //
            'static/fonts/Liberation_Sans-Regular.ttf'
          ],
        },
        active: proceedWithFonts,
        inactive: proceedWithFonts,
        fontactive: function(fontFamily, fontDescription) {
          console.log("font active: ", fontFamily, fontDescription);
        },
        fontloading: function(fontFamily, fontDescription) {
          console.log("font loading:", fontFamily, fontDescription);
        },
      };
      $.getScript('client/lib/webfont.js');


      dispatcher.
          on('collectionChanged', collectionChanged).
          on('collectionLoaded', collectionLoaded).
          on('renderData', renderData).
          on('isReloadOkay', isReloadOkay).
          on('resetData', resetData).
          on('abbrevs', setAbbrevs).
          on('textBackgrounds', setTextBackgrounds).
          on('layoutDensity', setLayoutDensity).
          on('svgWidth', setSvgWidth).
          on('current', gotCurrent).
          on('clearSVG', clearSVG).
          on('mouseover', onMouseOver).
          on('mouseout', onMouseOut);
    };

    return Visualizer;
})(jQuery, window);
