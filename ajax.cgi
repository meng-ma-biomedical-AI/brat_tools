#!/usr/bin/env python
# -*- Mode: Python; tab-width: 4; indent-tabs-mode: nil; -*- 
# vim:set ft=python ts=4 sw=4 sts=4 autoindent:

'''
Enty for CGI calls to brat. A simple wrapper around the CGI handling that then
delegates the work to the CGI-agnostic brat server.

Author:     Pontus Stenetorp    <pontus is s u-tokyo ac jp>
Version:    2011-02-07
'''

# Standard library imports
from cgi import FieldStorage
from os import environ
from os.path import dirname
from os.path import join as path_join
from sys import path as sys_path, stdout

# Local imports
sys_path.append(path_join(dirname(__file__), 'server/src'))

from server import serve

def main(args):
    # Get data required for server call
    try:
        remote_addr = environ['REMOTE_ADDR']
    except KeyError:
        remote_addr = None
    try:
        remote_host = environ['REMOTE_HOST']
    except KeyError:
        remote_host = None
    try:
        cookie_data = environ['HTTP_COOKIE']
    except KeyError:
        cookie_data = None

    params = FieldStorage()

    # Call main server
    cookie_hdrs, response_data = serve(params, remote_addr, remote_host,
            cookie_data)

    # Package and send response
    if cookie_hdrs is not None:
        response_hdrs = [hdr for hdr in cookie_hdrs]
    else:
        response_hdrs = []
    response_hdrs.extend(response_data[0])

    stdout.write('\n'.join('%s: %s' % (k, v) for k, v in response_hdrs))
    stdout.write('\n')
    stdout.write('\n')
    # Hack to support binary data and general Unicode for SVGs and JSON
    if isinstance(response_data[1], unicode):
        stdout.write(response_data[1].encode('utf-8'))
    else:
        stdout.write(response_data[1])
    return 0

if __name__ == '__main__':
    from sys import argv, exit
    exit(main(argv))
