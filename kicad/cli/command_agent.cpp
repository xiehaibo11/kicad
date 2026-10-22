/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#include "command_agent.h"

#include <cli/exit_codes.h>
#include <gestfich.h>
#include <string_utils.h>
#include <wx/crt.h>
#include <wx/filename.h>
#include <wx/utils.h>
#include <wx/stdpaths.h>
#include <wx/arrstr.h>

#include <string>
#include <vector>

CLI::AGENT_COMMAND::AGENT_COMMAND() : COMMAND( "agent" )
{
    m_argParser.add_description(
            UTF8STDSTR( _( "Run the kicad-direct AI automation terminal.  All arguments are "
                           "passed through: actions, call, sch, pipeline, workflow, ai." ) ) );

    m_argParser.add_argument( "args" )
            .remaining()
            .help( UTF8STDSTR( _( "Arguments passed to kicad-direct" ) ) );
}


#ifdef __WXMSW__
static constexpr const char* AGENT_EXE_NAME = "kicad-direct.mjs";
#else
static constexpr const char* AGENT_EXE_NAME = "kicad-direct.mjs";
#endif


int CLI::AGENT_COMMAND::doPerform( KIWAY& aKiway )
{
    wxString agentPath;

    if( !wxGetEnv( wxT( "KICAD_DIRECT" ), &agentPath ) || agentPath.IsEmpty() )
        agentPath = FindKicadFile( AGENT_EXE_NAME );

    // Build trees put the agent in <build>/bin, which FindKicadFile() does not
    // probe.  Walk up from kicad-cli until we find it.
    if( ( agentPath.IsEmpty() || !wxFileName::FileExists( agentPath ) )
        && wxGetEnv( wxT( "KICAD_RUN_FROM_BUILD_DIR" ), nullptr ) )
    {
        wxFileName exeDir( wxStandardPaths::Get().GetExecutablePath() );

        for( int i = 0; i < 8 && exeDir.GetDirCount() > 0; ++i )
        {
            wxFileName candidate( exeDir.GetPath(), AGENT_EXE_NAME );
            candidate.AppendDir( wxT( "bin" ) );

            if( wxFileName::FileExists( candidate.GetFullPath() ) )
            {
                agentPath = candidate.GetFullPath();
                break;
            }

            exeDir.RemoveLastDir();
        }
    }

    if( agentPath.IsEmpty() || !wxFileName::FileExists( agentPath ) )
    {
        wxFprintf( stderr,
                   _( "kicad-direct was not found.  Build it with "
                      "-DKICAD_BUILD_AI_AGENT=ON or set KICAD_DIRECT to its path.\n" ) );
        return EXIT_CODES::ERR_UNKNOWN;
    }

    // The agent shells out to kicad-cli; a bundle install is not on PATH.
    wxSetEnv( wxT( "KICAD_CLI" ), wxStandardPaths::Get().GetExecutablePath() );

    std::vector<std::string> argStore;
    wxString nodePath;
    if( !wxGetEnv( wxT( "KICAD_NODE" ), &nodePath ) || nodePath.IsEmpty() )
        nodePath = wxT( "node" );
    argStore.push_back( nodePath.ToUTF8().data() );
    argStore.push_back( agentPath.ToUTF8().data() );

    if( m_argParser.is_used( "args" ) )
    {
        for( const std::string& arg : m_argParser.get<std::vector<std::string>>( "args" ) )
            argStore.push_back( arg );
    }

    std::vector<const char*> argv;
    argv.reserve( argStore.size() + 1 );

    for( const std::string& arg : argStore )
        argv.push_back( arg.c_str() );

    argv.push_back( nullptr );

    long exitCode = wxExecute( argv.data(), wxEXEC_SYNC, nullptr );

    if( exitCode < 0 )
    {
        wxFprintf( stderr, _( "Failed to start kicad-direct.\n" ) );
        return EXIT_CODES::ERR_UNKNOWN;
    }

    return static_cast<int>( exitCode );
}
