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

#pragma once

#include <atomic>
#include <chrono>

#include <jobs/job.h>
#include <kicommon.h>
#include <progress_reporter.h>

/**
 * Progress reporter wrapper that enforces a job deadline and cooperative cancellation.
 *
 * Progress updates are forwarded to an optional delegate reporter.  KeepRefreshing() forwards
 * to the delegate so GUI reporters can pump events, but only treats the delegate's false return
 * as cancellation when the delegate reports itself cancelled.  KiCad's CLI reporter returns
 * false unconditionally to mean "no cancel channel", so it must not stop the engine.
 */
class KICOMMON_API JOB_PROGRESS_REPORTER : public PROGRESS_REPORTER
{
public:
    JOB_PROGRESS_REPORTER( JOB* aJob, PROGRESS_REPORTER* aDelegate = nullptr );

    void SetNumPhases( int aNumPhases ) override;
    void AddPhases( int aNumPhases ) override;
    void BeginPhase( int aPhase ) override;
    void AdvancePhase() override;
    void AdvancePhase( const wxString& aMessage ) override;
    void Report( const wxString& aMessage ) override;
    void SetCurrentProgress( double aProgress ) override;
    void SetMaxProgress( int aMaxProgress ) override;
    void AdvanceProgress() override;
    bool KeepRefreshing( bool aWait = false ) override;
    void SetTitle( const wxString& aTitle ) override;
    bool IsCancelled() const override;

    bool TimedOut() const { return m_timedOut.load( std::memory_order_relaxed ); }
    bool CancelRequested() const { return m_job && m_job->IsCancelRequested(); }

private:
    bool checkDeadline();

    JOB*                                 m_job;
    PROGRESS_REPORTER*                   m_delegate;
    std::chrono::steady_clock::time_point m_deadline;
    std::atomic<bool>                    m_timedOut{ false };
};
