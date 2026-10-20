/*
 * This program source code file is part of KiCad, a free EDA CAD application.
 *
 * Copyright (C) 2022 Mark Roszko <mark.roszko@gmail.com>
 * Copyright The KiCad Developers, see AUTHORS.txt for contributors.
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

#include <cli/exit_codes.h>
#include <jobs/job_dispatcher.h>
#include <jobs/job_progress_reporter.h>
#include <reporter.h>
#include <wx/debug.h>

class wxWindow;

JOB_DISPATCHER::JOB_DISPATCHER( KIWAY* aKiway ) :
        m_kiway( aKiway )
{
    m_reporter = &NULL_REPORTER::GetInstance();
    m_progressReporter = nullptr;
}


void JOB_DISPATCHER::Register( const std::string&             aJobTypeName,
                               std::function<int( JOB* job )> aHandler,
                               std::function<bool( JOB* aJob, wxWindow* aParent )> aConfigHandler )
{
    m_jobHandlers.emplace( aJobTypeName, aHandler );
    m_jobConfigHandlers.emplace( aJobTypeName, aConfigHandler );
}


int JOB_DISPATCHER::RunJob( JOB* job, REPORTER* aReporter, PROGRESS_REPORTER* aProgressReporter )
{
    if( !job )
        return CLI::EXIT_CODES::ERR_ARGS;

    int       result = CLI::EXIT_CODES::ERR_UNKNOWN;
    REPORTER*          existingReporter = m_reporter;
    JOB*               existingJob = m_currentJob;
    PROGRESS_REPORTER* existingProgressReporter = m_progressReporter;

    if( aReporter )
        m_reporter = aReporter;

    job->ClearExistingOutputs();
    job->ClearCancelRequest();

    // Always install the deadline-aware wrapper.  It forwards progress to the caller's reporter
    // (if any) but owns cancellation/timeout semantics, so engines do not need to know about
    // them.
    JOB_PROGRESS_REPORTER progressReporter( job, aProgressReporter );

    m_progressReporter = &progressReporter;
    m_currentJob = job;

    try
    {
        if( m_jobHandlers.count( job->GetType() ) )
            result = m_jobHandlers[job->GetType()]( job );
    }
    catch( ... )
    {
        m_currentJob = existingJob;
        m_reporter = existingReporter;
        m_progressReporter = existingProgressReporter;
        throw;
    }

    // Only report a timeout that the engine actually observed.  A handler that
    // finished before returning must not have its result relabeled just
    // because wall-clock time exceeded the timeout afterwards.
    if( progressReporter.TimedOut() )
        result = CLI::EXIT_CODES::ERR_TIMEOUT;
    else if( progressReporter.CancelRequested() || progressReporter.DelegateCancelled() )
        result = CLI::EXIT_CODES::ERR_CANCELLED;

    m_currentJob = existingJob;
    m_reporter = existingReporter;
    m_progressReporter = existingProgressReporter;

    return result;
}


bool JOB_DISPATCHER::HandleJobConfig( JOB* job, wxWindow* aParent )
{
    if( m_jobConfigHandlers.count( job->GetType() ) )
    {
        return m_jobConfigHandlers[job->GetType()]( job, aParent );
    }

    return false;
}


void JOB_DISPATCHER::SetReporter( REPORTER* aReporter )
{
    wxCHECK( aReporter != nullptr, /*void*/ );
    m_reporter = aReporter;
}


void JOB_DISPATCHER::SetProgressReporter( PROGRESS_REPORTER* aReporter )
{
    wxCHECK( aReporter != nullptr, /*void*/ );
    m_progressReporter = aReporter;
}