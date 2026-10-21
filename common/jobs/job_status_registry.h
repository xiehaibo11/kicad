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

#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <unordered_map>

#include <jobs/job.h>
#include <kicommon.h>

/**
 * Runtime registry of dispatched jobs.
 *
 * Jobs themselves are synchronous: RunJob blocks the calling thread.  This
 * registry records their ids, timings, and final state so GetJobStatus can
 * report them after completion, and CancelJob can set the cooperative cancel
 * flag if a job is being run on another thread.
 */
struct KICOMMON_API JOB_INSTANCE_INFO
{
    wxString jobId;
    wxString type;
    wxString message;
    int      status = 0;      // kiapi::common::types::JobStatus value
    int64_t  elapsedMs = 0;
    bool     running = false;
};

class KICOMMON_API JOB_STATUS_REGISTRY
{
public:
    // kiapi::common::types::JobStatus::JS_RUNNING; kept as an int so the common
    // library does not depend on the generated API headers.
    static constexpr int STATUS_RUNNING = 6;

    static void Start( JOB* aJob, const wxString& aJobId );

    static void Finish( const wxString& aJobId, int aStatus, int64_t aElapsedMs,
                        const wxString& aMessage );

    static bool Get( const wxString& aJobId, JOB_INSTANCE_INFO& aOut );

    /// @return true if a running job was found and its cancel flag was set.
    static bool Cancel( const wxString& aJobId );

private:
    struct ENTRY
    {
        JOB*                                 job = nullptr;
        wxString                             type;
        wxString                             message;
        int                                  status = 0;
        int64_t                              elapsedMs = 0;
        bool                                 running = false;
        std::chrono::steady_clock::time_point start;
    };

    static std::mutex& mutex();
    static std::unordered_map<std::string, ENTRY>& entries();
    static void pruneLocked();
};
