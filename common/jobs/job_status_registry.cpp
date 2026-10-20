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

#include <jobs/job_status_registry.h>

namespace
{
constexpr size_t MAX_RETAINED_JOBS = 256;
}

std::mutex& JOB_STATUS_REGISTRY::mutex()
{
    static std::mutex s_mutex;
    return s_mutex;
}


std::unordered_map<std::string, JOB_STATUS_REGISTRY::ENTRY>& JOB_STATUS_REGISTRY::entries()
{
    static std::unordered_map<std::string, ENTRY> s_entries;
    return s_entries;
}


void JOB_STATUS_REGISTRY::pruneLocked()
{
    auto& map = entries();

    while( map.size() > MAX_RETAINED_JOBS )
    {
        auto oldest = map.end();

        for( auto it = map.begin(); it != map.end(); ++it )
        {
            if( it->second.running )
                continue;

            if( oldest == map.end() || it->second.start < oldest->second.start )
                oldest = it;
        }

        if( oldest == map.end() )
            break;

        map.erase( oldest );
    }
}


void JOB_STATUS_REGISTRY::Start( JOB* aJob, const wxString& aJobId )
{
    if( !aJob || aJobId.IsEmpty() )
        return;

    std::scoped_lock lock( mutex() );

    ENTRY& entry = entries()[aJobId.ToStdString()];
    entry.job = aJob;
    entry.type = aJob->GetType();
    entry.message.clear();
    entry.status = STATUS_RUNNING;
    entry.elapsedMs = 0;
    entry.running = true;
    entry.start = std::chrono::steady_clock::now();

    pruneLocked();
}


void JOB_STATUS_REGISTRY::Finish( const wxString& aJobId, int aStatus, int64_t aElapsedMs,
                                  const wxString& aMessage )
{
    if( aJobId.IsEmpty() )
        return;

    std::scoped_lock lock( mutex() );

    auto it = entries().find( aJobId.ToStdString() );

    if( it == entries().end() )
        return;

    it->second.job = nullptr;
    it->second.status = aStatus;
    it->second.elapsedMs = aElapsedMs;
    it->second.message = aMessage;
    it->second.running = false;
}


bool JOB_STATUS_REGISTRY::Get( const wxString& aJobId, JOB_INSTANCE_INFO& aOut )
{
    std::scoped_lock lock( mutex() );

    auto it = entries().find( aJobId.ToStdString() );

    if( it == entries().end() )
        return false;

    aOut.jobId = wxString::FromUTF8( it->first );
    aOut.type = it->second.type;
    aOut.message = it->second.message;
    aOut.status = it->second.status;
    aOut.elapsedMs = it->second.elapsedMs;
    aOut.running = it->second.running;

    return true;
}


bool JOB_STATUS_REGISTRY::Cancel( const wxString& aJobId )
{
    std::scoped_lock lock( mutex() );

    auto it = entries().find( aJobId.ToStdString() );

    if( it == entries().end() || !it->second.running || !it->second.job )
        return false;

    // The lock is held while touching the JOB pointer so Finish() cannot clear
    // it (and the caller cannot destroy the job) until RequestCancel returns.
    it->second.job->RequestCancel();
    it->second.message = wxS( "Cancel requested" );

    return true;
}
