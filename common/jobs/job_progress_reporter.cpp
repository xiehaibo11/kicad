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

#include <jobs/job_progress_reporter.h>

JOB_PROGRESS_REPORTER::JOB_PROGRESS_REPORTER( JOB* aJob, PROGRESS_REPORTER* aDelegate ) :
        m_job( aJob ),
        m_delegate( aDelegate )
{
    if( m_job && m_job->GetTimeoutMs() > 0 )
        m_deadline = std::chrono::steady_clock::now()
                     + std::chrono::milliseconds( m_job->GetTimeoutMs() );
    else
        m_deadline = std::chrono::steady_clock::time_point::max();
}


bool JOB_PROGRESS_REPORTER::checkDeadline() const
{
    if( std::chrono::steady_clock::now() < m_deadline )
        return false;

    m_timedOut.store( true, std::memory_order_relaxed );

    if( m_job )
        m_job->RequestCancel();

    return true;
}


void JOB_PROGRESS_REPORTER::SetNumPhases( int aNumPhases )
{
    if( m_delegate )
        m_delegate->SetNumPhases( aNumPhases );
}


void JOB_PROGRESS_REPORTER::AddPhases( int aNumPhases )
{
    if( m_delegate )
        m_delegate->AddPhases( aNumPhases );
}


void JOB_PROGRESS_REPORTER::BeginPhase( int aPhase )
{
    checkDeadline();

    if( m_delegate )
        m_delegate->BeginPhase( aPhase );
}


void JOB_PROGRESS_REPORTER::AdvancePhase()
{
    checkDeadline();

    if( m_delegate )
        m_delegate->AdvancePhase();
}


void JOB_PROGRESS_REPORTER::AdvancePhase( const wxString& aMessage )
{
    checkDeadline();

    if( m_delegate )
        m_delegate->AdvancePhase( aMessage );
}


void JOB_PROGRESS_REPORTER::Report( const wxString& aMessage )
{
    checkDeadline();

    if( m_delegate )
        m_delegate->Report( aMessage );
}


void JOB_PROGRESS_REPORTER::SetCurrentProgress( double aProgress )
{
    checkDeadline();

    if( m_delegate )
        m_delegate->SetCurrentProgress( aProgress );
}


void JOB_PROGRESS_REPORTER::SetMaxProgress( int aMaxProgress )
{
    if( m_delegate )
        m_delegate->SetMaxProgress( aMaxProgress );
}


void JOB_PROGRESS_REPORTER::AdvanceProgress()
{
    checkDeadline();

    if( m_delegate )
        m_delegate->AdvanceProgress();
}


bool JOB_PROGRESS_REPORTER::KeepRefreshing( bool aWait )
{
    if( checkDeadline() )
        return false;

    if( m_job && m_job->IsCancelRequested() )
        return false;

    if( m_delegate )
    {
        // Forward so GUI reporters can pump events.  Some reporters (notably the CLI one)
        // return false unconditionally to mean "no cancel channel"; only treat a false return
        // as cancellation when the delegate actually reports itself cancelled.
        const bool delegateOk = m_delegate->KeepRefreshing( aWait );

        if( !delegateOk && m_delegate->IsCancelled() )
            return false;
    }

    return true;
}


void JOB_PROGRESS_REPORTER::SetTitle( const wxString& aTitle )
{
    if( m_delegate )
        m_delegate->SetTitle( aTitle );
}


bool JOB_PROGRESS_REPORTER::IsCancelled() const
{
    checkDeadline();

    return m_timedOut.load( std::memory_order_relaxed )
           || ( m_job && m_job->IsCancelRequested() )
           || ( m_delegate && m_delegate->IsCancelled() );
}
