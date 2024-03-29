#!/usr/bin/env python
# -*- Mode: Python; tab-width: 4; indent-tabs-mode: nil; coding: utf-8; -*-
# vim:set ft=python ts=4 sw=4 sts=4 autoindent:

# XXX: This module along with stats and annotator is pretty much pure chaos

from __future__ import with_statement

'''
Document handling functionality.

Author:     Pontus Stenetorp    <pontus is s u-tokyo ac jp>
            Illes Solt          <solt tmit bme hu>
Version:    2011-04-21
'''

from os import listdir
from os.path import abspath, isabs, isdir, normpath, getmtime
from os.path import join as path_join
from re import match,sub
from errno import ENOENT, EACCES

from annotation import (TextAnnotations, TEXT_FILE_SUFFIX,
        AnnotationFileNotFoundError, 
        AnnotationCollectionNotFoundError,
        JOINED_ANN_FILE_SUFF,
        open_textfile)
from common import ProtocolError, CollectionNotAccessibleError
from config import DATA_DIR
from projectconfig import (ProjectConfiguration, SEPARATOR_STR, 
        SPAN_DRAWING_ATTRIBUTES, ARC_DRAWING_ATTRIBUTES,
        VISUAL_SPAN_DEFAULT, VISUAL_ARC_DEFAULT, 
        ATTR_DRAWING_ATTRIBUTES, VISUAL_ATTR_DEFAULT,
        ENTITY_NESTING_TYPE)
from stats import get_statistics
from message import Messager
from auth import allowed_to_read, AccessDeniedError
from annlog import annotation_logging_active

try:
    from config import PERFORM_VERIFICATION
except ImportError:
    PERFORM_VERIFICATION = False

try:
    from config import JAPANESE
except ImportError:
    JAPANESE = False

try:
    from config import NER_TAGGING_SERVICES
except ImportError:
    NER_TAGGING_SERVICES = []

from itertools import chain

def _fill_type_configuration(nodes, project_conf, hotkey_by_type):
    items = []
    for node in nodes:
        if node == SEPARATOR_STR:
            items.append(None)
        else:
            item = {}
            _type = node.storage_form() 

            # This isn't really a great place to put this, but we need
            # to block this magic value from getting to the client.
            # TODO: resolve cleanly, preferably by not storing this with
            # other relations at all.
            if _type == ENTITY_NESTING_TYPE:
                continue

            item['name'] = project_conf.preferred_display_form(_type)
            item['type'] = _type
            item['unused'] = node.unused
            item['labels'] = project_conf.get_labels_by_type(_type)
            item['attributes'] = project_conf.attributes_for(_type)

            span_drawing_conf = project_conf.get_drawing_config_by_type(_type) 
            if span_drawing_conf is None:
                span_drawing_conf = project_conf.get_drawing_config_by_type(VISUAL_SPAN_DEFAULT)
            if span_drawing_conf is None:
                span_drawing_conf = {}
            for k in SPAN_DRAWING_ATTRIBUTES:
                if k in span_drawing_conf:
                    item[k] = span_drawing_conf[k]
            
            try:
                item['hotkey'] = hotkey_by_type[_type]
            except KeyError:
                pass

            arcs = []

            # Note: for client, relations are represented as "arcs"
            # attached to "spans" corresponding to entity annotations.

            # To avoid redundant entries, fill each type at most once.
            filled_arc_type = {}

            for arc in chain(project_conf.relation_types_from(_type), node.arg_list):
                if arc in filled_arc_type:
                    continue
                filled_arc_type[arc] = True

                curr_arc = {}
                curr_arc['type'] = arc

                arc_labels = project_conf.get_labels_by_type(arc)
                curr_arc['labels'] = arc_labels if arc_labels is not None else [arc]

                try:
                    curr_arc['hotkey'] = hotkey_by_type[arc]
                except KeyError:
                    pass
                
                arc_drawing_conf = project_conf.get_drawing_config_by_type(arc)
                if arc_drawing_conf is None:
                    arc_drawing_conf = project_conf.get_drawing_config_by_type(VISUAL_ARC_DEFAULT)
                if arc_drawing_conf is None:
                    arc_drawing_conf = {}
                for k in ARC_DRAWING_ATTRIBUTES:
                    if k in arc_drawing_conf:
                        curr_arc[k] = arc_drawing_conf[k]                    

                # Client needs also possible arc 'targets',
                # defined as the set of types (entity or event) that
                # the arc can connect to

                # This bit doesn't make sense for relations, which are
                # already "arcs" (see comment above).
                # TODO: determine if this should be an error: relation
                # config should now go through _fill_relation_configuration
                # instead.
                if project_conf.is_relation_type(_type):
                    targets = []
                else:
                    targets = []
                    # TODO: should include this functionality in projectconf
                    for ttype in project_conf.get_entity_types() + project_conf.get_event_types():
                        if arc in project_conf.arc_types_from_to(_type, ttype):
                            targets.append(ttype)
                curr_arc['targets'] = targets

                arcs.append(curr_arc)
                    
            # If we found any arcs, attach them
            if arcs:
                item['arcs'] = arcs

            item['children'] = _fill_type_configuration(node.children,
                    project_conf, hotkey_by_type)
            items.append(item)
    return items

# TODO: duplicates part of _fill_type_configuration
def _fill_relation_configuration(nodes, project_conf, hotkey_by_type):
    items = []
    for node in nodes:
        if node == SEPARATOR_STR:
            items.append(None)
        else:
            item = {}
            _type = node.storage_form() 

            if _type == ENTITY_NESTING_TYPE:
                continue

            item['name'] = project_conf.preferred_display_form(_type)
            item['type'] = _type
            item['unused'] = node.unused
            item['labels'] = project_conf.get_labels_by_type(_type)
            item['attributes'] = project_conf.attributes_for(_type)

            # TODO: avoid magic value
            item['properties'] = {}
            if '<REL-TYPE>' in node.special_arguments:
                for special_argument in node.special_arguments['<REL-TYPE>']:
                    item['properties'][special_argument] = True

            arc_drawing_conf = project_conf.get_drawing_config_by_type(_type)
            if arc_drawing_conf is None:
                arc_drawing_conf = project_conf.get_drawing_config_by_type(VISUAL_ARC_DEFAULT)
            if arc_drawing_conf is None:
                arc_drawing_conf = {}
            for k in ARC_DRAWING_ATTRIBUTES:
                if k in arc_drawing_conf:
                    item[k] = arc_drawing_conf[k]                    
            
            try:
                item['hotkey'] = hotkey_by_type[_type]
            except KeyError:
                pass

            # minimal info on argument types to allow differentiation of e.g.
            # "Equiv(Protein, Protein)" and "Equiv(Organism, Organism)"
            args = []
            for arg in node.arg_list:
                curr_arg = {}
                curr_arg['role'] = arg
                # TODO: special type (e.g. "<ENTITY>") expansion via projectconf
                curr_arg['targets'] = node.arguments[arg]

                args.append(curr_arg)

            item['args'] = args

            item['children'] = _fill_relation_configuration(node.children,
                    project_conf, hotkey_by_type)
            items.append(item)
    return items


# TODO: this may not be a good spot for this
def _fill_attribute_configuration(nodes, project_conf):
    items = []
    for node in nodes:
        if node == SEPARATOR_STR:
            continue
        else:
            item = {}
            _type = node.storage_form() 
            item['name'] = project_conf.preferred_display_form(_type)
            item['type'] = _type
            item['unused'] = node.unused
            item['labels'] = project_conf.get_labels_by_type(_type)

            attr_drawing_conf = project_conf.get_drawing_config_by_type(_type)
            if attr_drawing_conf is None:
                attr_drawing_conf = project_conf.get_drawing_config_by_type(VISUAL_ATTR_DEFAULT)
            if attr_drawing_conf is None:
                attr_drawing_conf = {}

            # TODO: "special" <DEFAULT> argument
            
            # send "special" arguments in addition to standard drawing
            # arguments
            ALL_ATTR_ARGS = ATTR_DRAWING_ATTRIBUTES + ["<GLYPH-POS>"]

            # Check if the possible values for the argument are specified
            # TODO: avoid magic string
            if "Value" in node.arguments:
                args = node.arguments["Value"]
            else:
                # no "Value" defined; assume binary.
                args = []

            if len(args) == 0:
                # binary; use drawing config directly
                item['values'] = { _type : {} }
                for k in ALL_ATTR_ARGS:
                    if k in attr_drawing_conf:
                        # protect against error from binary attribute
                        # having multi-valued visual config (#698)
                        if isinstance(attr_drawing_conf[k], list):
                            Messager.warning("Visual config error: expected single value for %s binary attribute '%s' config, found %d. Visuals may be wrong." % (_type, k, len(attr_drawing_conf[k])))
                            # fall back on the first just to have something.
                            item['values'][_type][k] = attr_drawing_conf[k][0]
                        else:
                            item['values'][_type][k] = attr_drawing_conf[k]
            else:
                # has normal arguments, use these as possible values.
                # (this is quite terrible all around, sorry.)
                item['values'] = {}
                for i, v in enumerate(args):
                    item['values'][v] = {}
                    # match up annotation config with drawing config by
                    # position in list of alternative values so that e.g.
                    # "Values:L1|L2|L3" can have the visual config
                    # "glyph:[1]|[2]|[3]". If only a single value is
                    # defined, apply to all.
                    for k in ALL_ATTR_ARGS:
                        if k in attr_drawing_conf:
                            # (sorry about this)
                            if isinstance(attr_drawing_conf[k], list):
                                # sufficiently many specified?
                                if len(attr_drawing_conf[k]) > i:
                                    item['values'][v][k] = attr_drawing_conf[k][i]
                                else:
                                    Messager.warning("Visual config error: expected %d values for %s attribute '%s' config, found only %d. Visuals may be wrong." % (len(args), v, k, len(attr_drawing_conf[k])))
                            else:
                                # single value (presumably), apply to all
                                item['values'][v][k] = attr_drawing_conf[k]

                    # if no drawing attribute was defined, fall back to
                    # using a glyph derived from the attribute value
                    if len([k for k in ATTR_DRAWING_ATTRIBUTES if
                            k in item['values'][v]]) == 0:
                        item['values'][v]['glyph'] = '['+v+']'

            # special treatment for special args ...
            # TODO: why don't we just use the same string on client as in conf?
            vals = item['values']
            for v in vals:
                if '<GLYPH-POS>' in vals[v]:
                    if vals[v]['<GLYPH-POS>'] not in ('left', 'right'):
                        Messager.warning('Configuration error: "%s" is not a valid glyph position for %s %s' % (vals[v]['<GLYPH-POS>'], _type, v))
                    else:
                        # rename
                        vals[v]['position'] = vals[v]['<GLYPH-POS>']
                    del vals[v]['<GLYPH-POS>']

            items.append(item)
    return items

def _fill_visual_configuration(types, project_conf):
    # similar to _fill_type_configuration, but for types for which
    # full annotation configuration was not found but some visual
    # configuration can be filled.

    # TODO: duplicates parts of _fill_type_configuration; combine?
    items = []
    for _type in types:
        item = {}
        item['name'] = project_conf.preferred_display_form(_type)
        item['type'] = _type
        item['unused'] = True
        item['labels'] = project_conf.get_labels_by_type(_type)

        drawing_conf = project_conf.get_drawing_config_by_type(_type) 
        # not sure if this is a good default, but let's try
        if drawing_conf is None:
            drawing_conf = project_conf.get_drawing_config_by_type(VISUAL_SPAN_DEFAULT)
        if drawing_conf is None:
            drawing_conf = {}
        # just plug in everything found, whether for a span or arc
        for k in chain(SPAN_DRAWING_ATTRIBUTES, ARC_DRAWING_ATTRIBUTES):
            if k in drawing_conf:
                item[k] = drawing_conf[k]

        # TODO: anything else?

        items.append(item)

    return items

# TODO: this is not a good spot for this
def get_span_types(directory):
    project_conf = ProjectConfiguration(directory)

    keymap = project_conf.get_kb_shortcuts()
    hotkey_by_type = dict((v, k) for k, v in keymap.iteritems())

    # fill config for nodes for which annotation is configured

    event_hierarchy = project_conf.get_event_type_hierarchy()
    event_types = _fill_type_configuration(event_hierarchy,
            project_conf, hotkey_by_type)

    entity_hierarchy = project_conf.get_entity_type_hierarchy()
    entity_types = _fill_type_configuration(entity_hierarchy,
            project_conf, hotkey_by_type)

    entity_attribute_hierarchy = project_conf.get_entity_attribute_type_hierarchy()
    entity_attribute_types = _fill_attribute_configuration(entity_attribute_hierarchy, project_conf)
    
    event_attribute_hierarchy = project_conf.get_event_attribute_type_hierarchy()
    event_attribute_types = _fill_attribute_configuration(event_attribute_hierarchy, project_conf)

    relation_hierarchy = project_conf.get_relation_type_hierarchy()
    relation_types = _fill_relation_configuration(relation_hierarchy,
            project_conf, hotkey_by_type)

    # make visual config available also for nodes for which there is
    # no annotation config. Note that defaults (SPAN_DEFAULT etc.)
    # are included via get_drawing_types() if defined.
    unconfigured = [l for l in (project_conf.get_labels().keys() +
                                project_conf.get_drawing_types()) if 
                    not project_conf.is_configured_type(l)]
    unconf_types = _fill_visual_configuration(unconfigured, project_conf)

    # TODO: this is just horrible. What's all this doing in a function
    # called get_span_types() anyway? Please fix.
    return event_types, entity_types, event_attribute_types, entity_attribute_types, relation_types, unconf_types

def get_search_config(directory):
    return ProjectConfiguration(directory).get_search_config()

def get_disambiguator_config(directory):
    return ProjectConfiguration(directory).get_disambiguator_config()

def get_annotator_config(directory):
    # TODO: "annotator" is a very confusing term for a web service
    # that does automatic annotation in the context of a tool
    # where most annotators are expected to be human. Rethink.
    return ProjectConfiguration(directory).get_annotator_config()

def assert_allowed_to_read(doc_path):
    if not allowed_to_read(doc_path):
        raise AccessDeniedError # Permission denied by access control

def real_directory(directory, rel_to=DATA_DIR):
    assert isabs(directory), 'directory "%s" is not absolute' % directory
    return path_join(rel_to, directory[1:])

def relative_directory(directory):
    # inverse of real_directory
    assert isabs(directory), 'directory "%s" is not absolute' % directory
    assert directory.startswith(DATA_DIR), 'directory "%s" not under DATA_DIR'
    return directory[len(DATA_DIR):]

def _is_hidden(file_name):
    return file_name.startswith('hidden_') or file_name.startswith('.')

def _listdir(directory):
    #return listdir(directory)
    try:
        assert_allowed_to_read(directory)
        return [f for f in listdir(directory) if not _is_hidden(f)
                and allowed_to_read(path_join(directory, f))]
    except OSError, e:
        Messager.error("Error listing %s: %s" % (directory, e))
        raise AnnotationCollectionNotFoundError(directory)
    
def _getmtime(file_path):
    '''
    Internal wrapper of getmtime that handles access denied and invalid paths
    according to our specification.

    Arguments:

    file_path - path to the file to get the modification time for
    '''

    try:
        return getmtime(file_path)
    except OSError, e:
        if e.errno in (EACCES, ENOENT):
            # The file did not exist or permission denied, we use -1 to
            #   indicate this since mtime > 0 is an actual time.
            return -1
        else:
            # We are unable to handle this exception, pass it one
            raise

# TODO: This is not the prettiest of functions
def get_directory_information(collection):
    directory = collection

    real_dir = real_directory(directory)
    
    assert_allowed_to_read(real_dir)
    
    # Get the document names
    base_names = [fn[0:-4] for fn in _listdir(real_dir)
            if fn.endswith('txt')]

    doclist = base_names[:]
    doclist_header = [("Document", "string")]

    # Then get the modification times
    doclist_with_time = []
    for file_name in doclist:
        file_path = path_join(DATA_DIR, real_dir,
            file_name + "." + JOINED_ANN_FILE_SUFF)
        doclist_with_time.append([file_name, _getmtime(file_path)])
    doclist = doclist_with_time
    doclist_header.append(("Modified", "time"))

    try:
        stats_types, doc_stats = get_statistics(real_dir, base_names)
    except OSError:
        # something like missing access permissions?
        raise CollectionNotAccessibleError
                
    doclist = [doclist[i] + doc_stats[i] for i in range(len(doclist))]
    doclist_header += stats_types

    dirlist = [dir for dir in _listdir(real_dir)
            if isdir(path_join(real_dir, dir))]
    # just in case, and for generality
    dirlist = [[dir] for dir in dirlist]

    # check whether at root, ignoring e.g. possible trailing slashes
    if normpath(real_dir) != normpath(DATA_DIR):
        parent = abspath(path_join(real_dir, '..'))[len(DATA_DIR) + 1:]
        # to get consistent processing client-side, add explicitly to list
        dirlist.append([".."])
    else:
        parent = None

    # combine document and directory lists, adding a column
    # differentiating files from directories and an unused column (can
    # point to a specific annotation) required by the protocol.  The
    # values filled here for the first are "c" for "collection"
    # (i.e. directory) and "d" for "document".
    combolist = []
    for i in dirlist:
        combolist.append(["c", None]+i)
    for i in doclist:
        combolist.append(["d", None]+i)

    event_types, entity_types, event_attribute_types, entity_attribute_types, relation_types, unconf_types = get_span_types(real_dir)

    # plug in the search config too
    search_config = get_search_config(real_dir)

    # ... and the disambiguator config ... this is getting a bit much
    disambiguator_config = get_disambiguator_config(real_dir)

    # read in README (if any) to send as a description of the
    # collection
    try:
        with open_textfile(path_join(real_dir, "README")) as txt_file:
            readme_text = txt_file.read()
    except IOError:
        readme_text = None

    # fill in a flag for whether annotator logging is active so that
    # the client knows whether to invoke timing actions
    ann_logging = annotation_logging_active()

    # fill in NER services, if any
    ner_taggers = NER_TAGGING_SERVICES

    json_dic = {
            'items': combolist,
            'header' : doclist_header,
            'parent': parent,
            'messages': [],
            'event_types': event_types,
            'entity_types': entity_types,
#             'attribute_types': attribute_types,
            'event_attribute_types': event_attribute_types,
            'entity_attribute_types': entity_attribute_types,
            'relation_types': relation_types,
            'unconfigured_types': unconf_types,
            'description': readme_text,
            'search_config': search_config,
            'disambiguator_config' : disambiguator_config,
            'annotation_logging': ann_logging,
            'ner_taggers': ner_taggers,
            }
    return json_dic

class UnableToReadTextFile(ProtocolError):
    def __init__(self, path):
        self.path = path

    def __str__(self):
        return 'Unable to read text file %s' % self.path

    def json(self, json_dic):
        json_dic['exception'] = 'unableToReadTextFile'
        return json_dic

class IsDirectoryError(ProtocolError):
    def __init__(self, path):
        self.path = path

    def __str__(self):
        return ''

    def json(self, json_dic):
        json_dic['exception'] = 'isDirectoryError'
        return json_dic

#TODO: All this enrichment isn't a good idea, at some point we need an object
def _enrich_json_with_text(j_dic, txt_file_path, raw_text=None):
    if raw_text is not None:
        # looks like somebody read this already; nice
        text = raw_text
    else:
        # need to read raw text
        try:
            with open_textfile(txt_file_path, 'r') as txt_file:
                text = txt_file.read()
        except IOError:
            raise UnableToReadTextFile(txt_file_path)
        except UnicodeDecodeError:
            Messager.error('Error reading text file: nonstandard encoding or binary?', -1)
            raise UnableToReadTextFile(txt_file_path)

    # TODO XXX huge hack, sorry, the client currently crashing on
    # chrome for two or more consecutive space, so replace every
    # second with literal non-breaking space. Note that this is just
    # for the client display -- server-side storage is not affected.
    # NOTE: it might be possible to fix this in a principled way by
    # having xml:space="preserve" on the relevant elements.
    text = text.replace("  ", ' '+unichr(0x00A0))

    j_dic['text'] = text
    
    from logging import info as log_info

    if JAPANESE:
        from ssplit import jp_sentence_boundary_gen
        from tokenise import jp_token_boundary_gen

        sentence_offsets = [o for o in jp_sentence_boundary_gen(text)]
        #log_info('offsets: ' + str(offsets))
        j_dic['sentence_offsets'] = sentence_offsets

        token_offsets = [o for o in jp_token_boundary_gen(text)]
        j_dic['token_offsets'] = token_offsets
    else:
        from ssplit import en_sentence_boundary_gen
        from tokenise import en_token_boundary_gen

        sentence_offsets = [o for o in en_sentence_boundary_gen(text)]
        #log_info('offsets: ' + str(sentence_offsets))
        j_dic['sentence_offsets'] = sentence_offsets
        
        token_offsets = [o for o in en_token_boundary_gen(text)]
        j_dic['token_offsets'] = token_offsets

    return True

def _enrich_json_with_data(j_dic, ann_obj):
    # We collect trigger ids to be able to link the textbound later on
    trigger_ids = set()
    for event_ann in ann_obj.get_events():
        trigger_ids.add(event_ann.trigger)
        j_dic['events'].append(
                [unicode(event_ann.id), unicode(event_ann.trigger), event_ann.args]
                )

    for rel_ann in ann_obj.get_relations():
        j_dic['relations'].append(
            [unicode(rel_ann.id), unicode(rel_ann.type), rel_ann.arg1, rel_ann.arg2]
            )

    for tb_ann in ann_obj.get_textbounds():
        j_tb = [unicode(tb_ann.id), tb_ann.type, tb_ann.start, tb_ann.end]

        # If we spotted it in the previous pass as a trigger for an
        # event or if the type is known to be an event type, we add it
        # as a json trigger.
        # TODO: proper handling of disconnected triggers. Currently
        # these will be erroneously passed as 'entities'
        if unicode(tb_ann.id) in trigger_ids:
            j_dic['triggers'].append(j_tb)
        else: 
            j_dic['entities'].append(j_tb)

    for eq_ann in ann_obj.get_equivs():
        j_dic['equivs'].append(
                (['*', eq_ann.type]
                    + [e for e in eq_ann.entities])
                )

    for att_ann in ann_obj.get_attributes():
        j_dic['attributes'].append(
                [unicode(att_ann.id), att_ann.type, att_ann.target, att_ann.value]
                )

    for com_ann in ann_obj.get_oneline_comments():
        j_dic['comments'].append(
                [com_ann.target, com_ann.type, com_ann.tail.strip()]
                )

    if ann_obj.failed_lines:
        error_msg = 'Unable to parse the following line(s):\n%s' % (
                '\n'.join(
                [('%s: %s' % (
                            # The line number is off by one
                            unicode(line_num + 1),
                            unicode(ann_obj[line_num])
                            )).strip()
                 for line_num in ann_obj.failed_lines])
                )
        Messager.error(error_msg, duration=len(ann_obj.failed_lines) * 3)

    j_dic['mtime'] = ann_obj.ann_mtime
    j_dic['ctime'] = ann_obj.ann_ctime

    try:
        if PERFORM_VERIFICATION:
            # XXX avoid digging the directory from the ann_obj
            import os
            docdir = os.path.dirname(ann_obj._document)
            projectconf = ProjectConfiguration(docdir)
            from verify_annotations import verify_annotation
            issues = verify_annotation(ann_obj, projectconf)
        else:
            issues = []
    except Exception, e:
        # TODO add an issue about the failure?
        issues = []
        Messager.error('Error: verify_annotation() failed: %s' % e, -1)

    for i in issues:
        j_dic['comments'].append((unicode(i.ann_id), i.type, i.description))

    # Attach the source files for the annotations and text
    from os.path import splitext
    from annotation import TEXT_FILE_SUFFIX
    ann_files = [splitext(p)[1][1:] for p in ann_obj._input_files]
    ann_files.append(TEXT_FILE_SUFFIX)
    ann_files = [p for p in set(ann_files)]
    ann_files.sort()
    j_dic['source_files'] = ann_files

def _enrich_json_with_base(j_dic):
    # TODO: Make the names here and the ones in the Annotations object conform
    # This is the from offset
    j_dic['offset'] = 0
    j_dic['entities'] = []
    j_dic['events'] = []
    j_dic['relations'] = []
    j_dic['triggers'] = []
    j_dic['modifications'] = []
    j_dic['attributes'] = []
    j_dic['equivs'] = []
    j_dic['comments'] = []

def _document_json_dict(document):
    #TODO: DOC!

    # pointing at directory instead of document?
    if isdir(document):
        raise IsDirectoryError(document)

    j_dic = {}
    _enrich_json_with_base(j_dic)

    #TODO: We don't check if the files exist, let's be more error friendly
    # Read in the textual data to make it ready to push
    _enrich_json_with_text(j_dic, document + '.' + TEXT_FILE_SUFFIX)

    with TextAnnotations(document) as ann_obj:
        # Note: At this stage the sentence offsets can conflict with the
        #   annotations, we thus merge any sentence offsets that lie within
        #   annotations
        # XXX: ~O(tb_ann * sentence_breaks), can be optimised
        # XXX: The merge strategy can lead to unforeseen consequences if two
        #   sentences are not adjacent (the format allows for this:
        #   S_1: [0, 10], S_2: [15, 20])
        s_breaks = j_dic['sentence_offsets']
        for tb_ann in ann_obj.get_textbounds():
            s_i = 0
            while s_i < len(s_breaks):
                s_start, s_end = s_breaks[s_i]
                # Does the annotation strech over the end of the sentence?
                if tb_ann.start < s_end and tb_ann.end > s_end:
                    # Merge this sentence and the next sentence
                    s_breaks[s_i] = (s_start, s_breaks[s_i + 1][1])
                    del s_breaks[s_i + 1]
                else:
                    s_i += 1
        
        _enrich_json_with_data(j_dic, ann_obj)

    return j_dic

def get_document(collection, document):
    directory = collection
    real_dir = real_directory(directory)
    doc_path = path_join(real_dir, document)
    return _document_json_dict(doc_path)

def get_document_timestamp(collection, document):
    directory = collection
    real_dir = real_directory(directory)
    assert_allowed_to_read(real_dir)
    doc_path = path_join(real_dir, document)
    ann_path = doc_path + '.' + JOINED_ANN_FILE_SUFF
    mtime = _getmtime(ann_path)

    return {
            'mtime': mtime,
            }
